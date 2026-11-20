use crate::ontology::{CreateTerrainVagueRequest, get_all_terrain_vagues, insert_terrain_vague};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Extension, Json, Router,
    extract::{Path, Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures::TryStreamExt;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use mongodb::{IndexModel, bson::doc, options::IndexOptions};
use reqwest::{StatusCode, header::AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

mod ontology;

const ACCESS_TOKEN_TTL_SECS: u64 = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SECS: u64 = 60 * 60 * 24 * 7; // 7 days

#[derive(Clone)]
struct AppState {
    secret: String,
    fuseki_url: String,
    fuseki_password: String,
    fuseki_client: reqwest::Client,
    db_client: mongodb::Client,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
enum UserRole {
    User,
    Admin,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
enum UserStatus {
    Pending,
    Active,
}

#[derive(Debug, Serialize, Deserialize)]
struct UserDocument {
    username: String,
    password_hash: String,
    role: UserRole,
    status: UserStatus,
    created_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Claims {
    sub: String,
    role: UserRole,
    token_type: String,
    exp: usize,
    iat: usize,
}

#[derive(Serialize)]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    token_type: &'static str,
    expires_in: u64,
}

#[derive(Serialize)]
struct UserSummary {
    username: String,
    role: UserRole,
    status: UserStatus,
    created_at: u64,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))).init();

    let state = AppState {
        secret: std::env::var("SECRET").unwrap_or_else(|_| "secret".into()),
        fuseki_url: std::env::var("SPARQL_ENDPOINT").unwrap_or_else(|_| "http://localhost:3030/observista".into()),
        fuseki_password: std::env::var("FUSEKI_PASSWORD").unwrap_or_else(|_| "admin".into()),
        fuseki_client: reqwest::Client::new(),
        db_client: mongodb::Client::with_uri_str(&std::env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://localhost:27017".into())).await.unwrap(),
    };

    ensure_user_indexes(&state.db_client).await;
    ontology::seed_ontology(&state.fuseki_client, &state.fuseki_url, &state.fuseki_password).await;

    let api_router = Router::new().route("/api/terrain-vague", get(list_terrain_vagues));
    let auth_router = Router::new().route("/api/terrain-vague", post(create_terrain_vague)).route("/api/users", get(list_users)).route("/api/users/{username}/approve", post(approve_user)).route_layer(middleware::from_fn_with_state(state.clone(), require_auth));
    let unauth_router = Router::new().route("/register", post(register)).route("/login", post(login)).route("/refresh_token", post(refresh_token));
    let app = unauth_router.merge(auth_router).merge(api_router).with_state(state).route_service("/favicon.ico", ServeFile::new("gui/favicon.ico")).nest_service("/assets", ServeDir::new("gui/assets")).fallback_service(ServeDir::new("gui").not_found_service(ServeFile::new("gui/index.html")));

    let port = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
    info!("Starting OBSERVISTA server on port {}", port);
    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn ensure_user_indexes(db_client: &mongodb::Client) {
    let users = db_client.database("observista").collection::<UserDocument>("users");
    let index = IndexModel::builder().keys(doc! { "username": 1 }).options(IndexOptions::builder().unique(true).build()).build();

    if let Err(err) = users.create_index(index).await {
        error!("Failed to create unique index on users.username: {}", err);
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn issue_token_pair(username: &str, role: &UserRole, secret: &str) -> Result<AuthResponse, StatusCode> {
    let now = current_timestamp();
    let encoding_key = EncodingKey::from_secret(secret.as_bytes()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let access_claims = Claims {
        sub: username.to_owned(),
        role: role.clone(),
        token_type: "access".to_owned(),
        iat: now as usize,
        exp: (now + ACCESS_TOKEN_TTL_SECS) as usize,
    };

    let refresh_claims = Claims {
        sub: username.to_owned(),
        role: role.clone(),
        token_type: "refresh".to_owned(),
        iat: now as usize,
        exp: (now + REFRESH_TOKEN_TTL_SECS) as usize,
    };

    let access_token = encode(&Header::default(), &access_claims, &encoding_key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let refresh_token = encode(&Header::default(), &refresh_claims, &encoding_key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(AuthResponse { access_token, refresh_token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECS })
}

fn verify_token(token: &str, secret: &str, expected_type: &str) -> Result<Claims, StatusCode> {
    let decoding_key = DecodingKey::from_secret(secret.as_bytes()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let validation = Validation::default();

    let token_data = decode::<Claims>(token, &decoding_key, &validation).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if token_data.claims.token_type != expected_type {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(token_data.claims)
}

async fn require_auth(State(state): State<AppState>, mut req: Request, next: Next) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let auth_header = req.headers().get(AUTHORIZATION).and_then(|h| h.to_str().ok()).ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Missing Authorization header" }))))?;

    let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid Authorization scheme, expected Bearer" }))))?;

    let claims = verify_token(token, &state.secret, "access").map_err(|_| (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid or expired access token" }))))?;

    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}

async fn list_terrain_vagues(State(state): State<AppState>) -> impl IntoResponse {
    match get_all_terrain_vagues(&state.fuseki_client, &state.fuseki_url).await {
        Ok(items) => (StatusCode::OK, Json(json!(items))),
        Err(err) => {
            tracing::error!("Error fetching terrain vagues: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": err })))
        }
    }
}

async fn create_terrain_vague(State(state): State<AppState>, Json(req): Json<CreateTerrainVagueRequest>) -> impl IntoResponse {
    match insert_terrain_vague(&state.fuseki_client, &state.fuseki_url, &state.fuseki_password, req).await {
        Ok(created) => (StatusCode::CREATED, Json(json!(created))),
        Err(err) => {
            tracing::error!("Error creating terrain vague: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": err })))
        }
    }
}

#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
}

async fn register(State(state): State<AppState>, Json(req): Json<Credentials>) -> impl IntoResponse {
    let username = req.username.trim();
    if username.len() < 3 || req.password.len() < 8 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Username must be at least 3 chars and password at least 8 chars" })));
    }

    let users = state.db_client.database("observista").collection::<UserDocument>("users");

    match users.find_one(doc! { "username": username }).await {
        Ok(Some(_)) => {
            return (StatusCode::CONFLICT, Json(json!({ "error": "Username already exists" })));
        }
        Err(err) => {
            error!("MongoDB error checking user: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })));
        }
        Ok(None) => {}
    }

    // First user to register becomes Admin and Active, others are User and Pending
    let is_first_user = users.count_documents(doc! {}).await.unwrap_or(1) == 0;
    let (role, status) = if is_first_user { (UserRole::Admin, UserStatus::Active) } else { (UserRole::User, UserStatus::Pending) };

    let password_hash = match Argon2::default().hash_password(req.password.as_bytes()) {
        Ok(hash) => hash.to_string(),
        Err(err) => {
            error!("Password hashing failed: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Failed to process credentials" })));
        }
    };

    let new_user = UserDocument {
        username: username.to_owned(),
        password_hash,
        role,
        status: status.clone(),
        created_at: current_timestamp(),
    };

    if let Err(err) = users.insert_one(new_user).await {
        error!("Failed to insert user into MongoDB: {}", err);
        return (StatusCode::CONFLICT, Json(json!({ "error": "Could not register user" })));
    }

    let message = if status == UserStatus::Active { "Administrator account created. You can now log in." } else { "Registration submitted. Your account is pending administrator approval." };

    (
        StatusCode::CREATED,
        Json(json!({
            "username": username,
            "status": status,
            "message": message
        })),
    )
}

async fn login(State(state): State<AppState>, Json(req): Json<Credentials>) -> impl IntoResponse {
    let username = req.username.trim();
    let users = state.db_client.database("observista").collection::<UserDocument>("users");

    let user = match users.find_one(doc! { "username": username }).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid username or password" })));
        }
        Err(err) => {
            error!("MongoDB error during login: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })));
        }
    };

    let parsed_hash = match PasswordHash::new(&user.password_hash) {
        Ok(h) => h,
        Err(err) => {
            error!("Corrupted password hash in DB for user {}: {}", username, err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Authentication error" })));
        }
    };

    if Argon2::default().verify_password(req.password.as_bytes(), &parsed_hash).is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid username or password" })));
    }

    match issue_token_pair(&user.username, &user.role, &state.secret) {
        Ok(tokens) => (StatusCode::OK, Json(json!(tokens))),
        Err(status) => (status, Json(json!({ "error": "Failed to issue tokens" }))),
    }
}

#[derive(Deserialize)]
struct RefreshTokenRequest {
    refresh_token: String,
}

async fn refresh_token(State(state): State<AppState>, Json(req): Json<RefreshTokenRequest>) -> impl IntoResponse {
    let claims = match verify_token(&req.refresh_token, &state.secret, "refresh") {
        Ok(c) => c,
        Err(_) => {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid or expired refresh token" })));
        }
    };

    let users = state.db_client.database("observista").collection::<UserDocument>("users");
    let user = match users.find_one(doc! { "username": &claims.sub }).await {
        Ok(Some(u)) if u.status == UserStatus::Active => u,
        Ok(_) => {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "User not found or inactive" })));
        }
        Err(err) => {
            error!("MongoDB error during token refresh: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })));
        }
    };

    match issue_token_pair(&user.username, &user.role, &state.secret) {
        Ok(tokens) => (StatusCode::OK, Json(json!(tokens))),
        Err(status) => (status, Json(json!({ "error": "Failed to issue tokens" }))),
    }
}

async fn list_users(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> impl IntoResponse {
    if claims.role != UserRole::Admin {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin privileges required" })));
    }

    let users = state.db_client.database("observista").collection::<UserDocument>("users");
    match users.find(doc! {}).await {
        Ok(cursor) => {
            let docs: Vec<UserDocument> = cursor.try_collect().await.unwrap_or_default();
            let list: Vec<UserSummary> = docs.into_iter().map(|u| UserSummary { username: u.username, role: u.role, status: u.status, created_at: u.created_at }).collect();
            (StatusCode::OK, Json(json!(list)))
        }
        Err(err) => {
            error!("MongoDB error listing users: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })))
        }
    }
}

async fn approve_user(State(state): State<AppState>, Extension(claims): Extension<Claims>, Path(target_username): Path<String>) -> impl IntoResponse {
    if claims.role != UserRole::Admin {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin privileges required" })));
    }

    let users = state.db_client.database("observista").collection::<UserDocument>("users");
    match users.update_one(doc! { "username": &target_username }, doc! { "$set": { "status": "Active" } }).await {
        Ok(res) if res.matched_count > 0 => (StatusCode::OK, Json(json!({ "message": format!("User '{}' approved", target_username) }))),
        Ok(_) => (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found" }))),
        Err(err) => {
            error!("MongoDB error approving user: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })))
        }
    }
}
