use axum::{
    body::Body,
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;
use std::borrow::Cow;

// Embarque les fichiers HTML à la racine
#[derive(RustEmbed)]
#[folder = "."]
#[include = "*.html"]
struct HtmlAssets;

// Embarque les fichiers statiques (CSS/JS)
#[derive(RustEmbed)]
#[folder = "static"]
struct StaticAssets;

fn build_response(content: Cow<'static, [u8]>, path: &str) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .body(Body::from(content.into_owned()))
        .unwrap()
}

pub async fn serve_embedded(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    // Si c'est la racine, rediriger vers login.html
    if path.is_empty() || path == "/" {
        return axum::response::Redirect::permanent("/login.html").into_response();
    }

    // Essayer de charger depuis les fichiers HTML
    if path.ends_with(".html") {
        if let Some(content) = <HtmlAssets as RustEmbed>::get(path) {
            return build_response(content.data, path);
        }
    }

    // Essayer de charger depuis les fichiers static
    if path.starts_with("static/") {
        let static_path = path.strip_prefix("static/").unwrap_or(path);
        if let Some(content) = <StaticAssets as RustEmbed>::get(static_path) {
            return build_response(content.data, static_path);
        }
    }

    // 404 si rien n'est trouvé
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::from("404 Not Found"))
        .unwrap()
}
