mod ontology;

use axum::{Json, Router, extract::State, response::IntoResponse, routing::post};
use serde::Deserialize;
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
struct AppState {
    secret: String,
    fuseki_url: String,
    fuseki_client: reqwest::Client,
    db_client: mongodb::Client,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))).init();

    let state = AppState {
        secret: std::env::var("SECRET").unwrap_or_else(|_| "secret".into()),
        fuseki_url: std::env::var("SPARQL_ENDPOINT").unwrap_or_else(|_| "http://localhost:3030/observista".into()),
        fuseki_client: reqwest::Client::new(),
        db_client: mongodb::Client::with_uri_str(&std::env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://localhost:27017".into())).await.unwrap(),
    };

    ontology::seed_ontology(&state.fuseki_client, &state.fuseki_url).await;

    let auth_router = Router::new();
    let unauth_router = Router::new().route("/register", post(register)).route("/login", post(login)).route("/refresh_token", post(refresh_token));

    let app = unauth_router.merge(auth_router).with_state(state).route_service("/favicon.ico", ServeFile::new("gui/favicon.ico")).nest_service("/assets", ServeDir::new("gui/assets")).fallback_service(ServeDir::new("gui").not_found_service(ServeFile::new("gui/index.html")));

    let port = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
    info!("Starting OBSERVISTA server on port {}", port);
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
}

async fn login(State(state): State<AppState>, Json(req): Json<Credentials>) -> impl IntoResponse {}

async fn register(State(state): State<AppState>, Json(req): Json<Credentials>) -> impl IntoResponse {}

#[derive(Deserialize)]
struct RefreshTokenRequest {
    refresh_token: String,
}

async fn refresh_token(State(state): State<AppState>, Json(req): Json<RefreshTokenRequest>) -> impl IntoResponse {}
