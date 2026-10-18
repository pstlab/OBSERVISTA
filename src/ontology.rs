use reqwest::Client;
use tokio::fs;

const SCHEMA_GRAPH: &str = "http://observista.eu/graph/schema";

pub async fn seed_ontology(http_client: &Client, fuseki_base_url: &str) {
    if let Ok(ttl_content) = fs::read_to_string("ontology/observista.ttl").await {
        let url = format!("{}/data?graph={}", fuseki_base_url, SCHEMA_GRAPH);
        match http_client.put(&url).header("Content-Type", "text/turtle").body(ttl_content).send().await {
            Ok(resp) if resp.status().is_success() => tracing::info!("Ontology seeded into Fuseki successfully"),
            Ok(resp) => tracing::warn!("Fuseki seed returned status: {}", resp.status()),
            Err(e) => tracing::error!("Failed to connect to Fuseki for seeding: {}", e),
        }
    }
}
