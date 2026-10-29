use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};
use tokio::{fs, time::sleep};
use tracing::{error, info, warn};
use uuid::Uuid;

const SCHEMA_GRAPH: &str = "http://observista.eu/graph/schema";
const DATA_GRAPH: &str = "http://observista.eu/graph/data";
const ONTOLOGY_NS: &str = "http://observista.eu/ontology/";

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTerrainVagueRequest {
    pub name: String,
    pub description: Option<String>,
    pub typology: Option<String>,
    pub wkt: String,
    pub geojson: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TerrainVagueDto {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub typology: Option<String>,
    pub wkt: String,
    pub geojson: Option<String>,
}

#[derive(Deserialize)]
struct SparqlResponse {
    results: SparqlResults,
}

#[derive(Deserialize)]
struct SparqlResults {
    bindings: Vec<HashMap<String, SparqlValue>>,
}

#[derive(Deserialize)]
struct SparqlValue {
    value: String,
}

fn escape_sparql_literal(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r")
}

pub async fn seed_ontology(http_client: &Client, fuseki_base_url: &str, fuseki_password: &str) {
    let fuseki_root = fuseki_base_url.trim_end_matches('/').rsplit_once('/').map(|(root, _)| root).unwrap_or(fuseki_base_url);

    if let Ok(config_ttl) = fs::read_to_string("ontology/fuseki-config.ttl").await {
        let admin_datasets_url = format!("{}/$/datasets", fuseki_root);

        for attempt in 1..=10 {
            let res = http_client.post(&admin_datasets_url).basic_auth("admin", Some(fuseki_password)).header("Content-Type", "text/turtle").body(config_ttl.clone()).send().await;

            match res {
                Ok(resp) if resp.status().is_success() => {
                    info!("Dataset 'observista' created with Reasoner on Fuseki");
                    break;
                }
                Ok(resp) if resp.status().as_u16() == 409 => {
                    info!("Dataset 'observista' already exists on Fuseki");
                    break;
                }
                Ok(resp) => {
                    warn!("Attempt {}/10: Fuseki admin returned {}", attempt, resp.status());
                }
                Err(e) => {
                    warn!("Attempt {}/10: Waiting for Fuseki ({})...", attempt, e);
                }
            }
            sleep(Duration::from_secs(2)).await;
        }
    }

    if let Ok(ttl_content) = fs::read_to_string("ontology/observista.ttl").await {
        let url = format!("{}/data?graph={}", fuseki_base_url, SCHEMA_GRAPH);
        match http_client.put(&url).basic_auth("admin", Some(fuseki_password)).header("Content-Type", "text/turtle").body(ttl_content).send().await {
            Ok(resp) if resp.status().is_success() => {
                info!("Ontology seeded into Fuseki successfully");
            }
            Ok(resp) => warn!("Fuseki seed returned status: {}", resp.status()),
            Err(e) => error!("Failed to seed ontology: {}", e),
        }
    } else {
        error!("Could not read ontology/observista.ttl");
    }
}

pub async fn get_all_terrain_vagues(http_client: &Client, fuseki_base_url: &str) -> Result<Vec<TerrainVagueDto>, String> {
    let query = r#"
        PREFIX : <http://observista.eu/ontology/>
        PREFIX geo: <http://www.opengis.net/ont/geosparql#>

        SELECT ?tv ?name ?description ?typology ?wkt ?geojson
        WHERE {
            ?tv a :TerrainVague ;
                :siteName ?name ;
                geo:hasDefaultGeometry ?geom .
            ?geom geo:asWKT ?wkt .
            OPTIONAL { ?tv :siteDescription ?description . }
            OPTIONAL { ?tv :hasTypology ?typology . }
            OPTIONAL { ?geom geo:asGeoJSON ?geojson . }
        }
    "#;

    let url = format!("{}-inf/sparql", fuseki_base_url);
    let resp = http_client.post(&url).header("Accept", "application/sparql-results+json").form(&[("query", query)]).send().await.map_err(|e| format!("SPARQL request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Fuseki error ({}): {}", status, body));
    }

    let sparql_resp: SparqlResponse = resp.json().await.map_err(|e| format!("Failed to parse SPARQL JSON: {}", e))?;

    let items = sparql_resp
        .results
        .bindings
        .into_iter()
        .filter_map(|mut b| {
            Some(TerrainVagueDto {
                uri: b.remove("tv")?.value,
                name: b.remove("name")?.value,
                description: b.remove("description").map(|v| v.value),
                typology: b.remove("typology").map(|v| v.value.strip_prefix(ONTOLOGY_NS).unwrap_or(&v.value).to_string()),
                wkt: b.remove("wkt")?.value,
                geojson: b.remove("geojson").map(|v| v.value),
            })
        })
        .collect();

    Ok(items)
}

pub async fn insert_terrain_vague(http_client: &Client, fuseki_base_url: &str, fuseki_password: &str, req: CreateTerrainVagueRequest) -> Result<TerrainVagueDto, String> {
    let id = Uuid::new_v4();
    let tv_local = format!("tv_{}", id.simple());
    let geom_local = format!("geom_{}", id.simple());
    let tv_uri = format!("{}{}", ONTOLOGY_NS, tv_local);

    let name_esc = escape_sparql_literal(&req.name);
    let wkt_esc = escape_sparql_literal(&req.wkt);

    let mut extra_tv_triples = String::new();
    if let Some(ref desc) = req.description {
        if !desc.trim().is_empty() {
            extra_tv_triples.push_str(&format!(" ;\n                :siteDescription \"{}\"", escape_sparql_literal(desc)));
        }
    }

    if let Some(ref typ) = req.typology {
        if !typ.is_empty() && typ.chars().all(|c| c.is_alphanumeric() || c == '_') {
            extra_tv_triples.push_str(&format!(" ;\n                :hasTypology :{}", typ));
        }
    }

    let mut extra_geom_triples = String::new();
    if let Some(ref gj) = req.geojson {
        if !gj.trim().is_empty() {
            extra_geom_triples.push_str(&format!(" ;\n                geo:asGeoJSON \"{}\"^^geo:geoJSONLiteral", escape_sparql_literal(gj)));
        }
    }

    let update_query = format!(
        r#"
        PREFIX : <http://observista.eu/ontology/>
        PREFIX owl: <http://www.w3.org/2002/07/owl#>
        PREFIX geo: <http://www.opengis.net/ont/geosparql#>

        INSERT DATA {{
            GRAPH <{data_graph}> {{
                :{tv_local} a owl:NamedIndividual , :TerrainVague , geo:Feature ;
                    :siteName "{name_esc}" ;
                    geo:hasDefaultGeometry :{geom_local}{extra_tv_triples} .

                :{geom_local} a owl:NamedIndividual , geo:Geometry ;
                    geo:asWKT "{wkt_esc}"^^geo:wktLiteral{extra_geom_triples} .
            }}
        }}
        "#,
        data_graph = DATA_GRAPH,
        tv_local = tv_local,
        geom_local = geom_local,
        name_esc = name_esc,
        wkt_esc = wkt_esc,
        extra_tv_triples = extra_tv_triples,
        extra_geom_triples = extra_geom_triples,
    );

    let url = format!("{}/update", fuseki_base_url);
    let resp = http_client.post(&url).basic_auth("admin", Some(fuseki_password)).header("Content-Type", "application/sparql-update").body(update_query).send().await.map_err(|e| format!("SPARQL update failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Fuseki update error ({}): {}", status, body));
    }

    Ok(TerrainVagueDto {
        uri: tv_uri,
        name: req.name,
        description: req.description,
        typology: req.typology,
        wkt: req.wkt,
        geojson: req.geojson,
    })
}
