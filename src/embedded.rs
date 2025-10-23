// Importations nécessaires depuis Axum pour la gestion des réponses HTTP,
// et `RustEmbed` pour l'intégration des fichiers statiques.
use axum::{
    body::Body,
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;
use std::borrow::Cow;

// La macro `#[derive(RustEmbed)]` transforme cette structure en un conteneur pour les fichiers embarqués.
// `#[folder = "."]` spécifie que les fichiers sont à la racine du projet.
// `#[include = "*.html"]` indique de n'inclure que les fichiers se terminant par .html.
// Performance : Ces fichiers sont chargés en mémoire au démarrage, permettant un accès quasi instantané sans I/O disque.
#[derive(RustEmbed)]
#[folder = "."]
#[include = "*.html"]
struct HtmlAssets;

// Une autre structure pour embarquer les fichiers du dossier `static` (CSS, JS, etc.).
#[derive(RustEmbed)]
#[folder = "static"]
struct StaticAssets;

// Fonction utilitaire pour construire une réponse HTTP à partir du contenu d'un fichier embarqué.
fn build_response(content: Cow<'static, [u8]>, path: &str) -> Response {
    // `mime_guess` détermine le type MIME du fichier à partir de son extension (ex: `text/html`, `text/css`).
    // C'est crucial pour que le navigateur interprète correctement le contenu.
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        // `Body::from(content.into_owned())` crée le corps de la réponse.
        // `content` est un `Cow` (Clone-on-Write), une optimisation qui évite de copier les données si ce n'est pas nécessaire.
        .body(Body::from(content.into_owned()))
        .unwrap()
}

// Le handler Axum principal pour servir les fichiers embarqués.
// Il reçoit l'URI demandée et retourne la réponse appropriée.
pub async fn serve_embedded(uri: Uri) -> Response {
    // Nettoie le chemin de l'URI.
    let path = uri.path().trim_start_matches('/');

    // Cas spécial : si la requête est pour la racine, on redirige vers `login.html`.
    if path.is_empty() || path == "/" {
        return axum::response::Redirect::permanent("/login.html").into_response();
    }

    // Tente de trouver le fichier dans les `HtmlAssets` (fichiers .html).
    if path.ends_with(".html") {
        // `<HtmlAssets as RustEmbed>::get(path)` recherche le fichier par son chemin.
        // C'est une recherche en mémoire, donc très rapide.
        if let Some(content) = <HtmlAssets as RustEmbed>::get(path) {
            // `content.data` est un `Cow<'static, [u8]>` contenant les octets du fichier.
            return build_response(content.data, path);
        }
    }

    // Si ce n'est pas un HTML, tente de le trouver dans les `StaticAssets`.
    if path.starts_with("static/") {
        // On retire le préfixe "static/" pour correspondre au chemin dans le dossier `static`.
        let static_path = path.strip_prefix("static/").unwrap_or(path);
        if let Some(content) = <StaticAssets as RustEmbed>::get(static_path) {
            return build_response(content.data, static_path);
        }
    }

    // Si le fichier n'est trouvé dans aucun des conteneurs, retourne une erreur 404 Not Found.
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::from("404 Not Found"))
        .unwrap()
}
