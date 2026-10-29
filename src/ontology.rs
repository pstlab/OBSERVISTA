use reqwest::Client;
use std::time::Duration;
use tokio::{fs, time::sleep};
use tracing::{error, info, warn};

const SCHEMA_GRAPH: &str = "http://observista.eu/graph/schema";

pub async fn seed_ontology(http_client: &Client, fuseki_base_url: &str) {
    let fuseki_password = std::env::var("FUSEKI_PASSWORD").unwrap_or_else(|_| "admin".into());

    if let Ok(ttl_content) = fs::read_to_string("ontology/observista.ttl").await {
        let url = format!("{}/data?graph={}", fuseki_base_url, SCHEMA_GRAPH);

        for attempt in 1..=10 {
            let res = http_client.put(&url).basic_auth("admin", Some(&fuseki_password)).header("Content-Type", "text/turtle").body(ttl_content.clone()).send().await;

            match res {
                Ok(resp) if resp.status().is_success() => {
                    info!("Ontology seeded into Fuseki successfully");
                    return;
                }
                Ok(resp) => {
                    warn!("Attempt {}/10: Fuseki returned status {}", attempt, resp.status());
                }
                Err(e) => {
                    warn!("Attempt {}/10: Waiting for Fuseki to be ready ({})...", attempt, e);
                }
            }
            sleep(Duration::from_secs(2)).await;
        }
        error!("Failed to seed ontology into Fuseki after 10 attempts");
    } else {
        error!("Could not read ontology/observista.ttl");
    }
}
