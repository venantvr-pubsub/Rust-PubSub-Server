// Importations nécessaires depuis Axum pour la gestion des réponses HTTP,
// et `RustEmbed` pour l'intégration des fichiers statiques.
use axum::{
    body::Body,
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::{EmbeddedFile, RustEmbed};

// La macro `#[derive(RustEmbed)]` transforme cette structure en un conteneur pour les fichiers embarqués.
// `#[folder = "."]` spécifie que les fichiers sont à la racine du projet.
// `#[include = "*.html"]` indique de n'inclure que les fichiers se terminant par .html.
// Performance : Ces fichiers sont chargés en mémoire au démarrage, permettant un accès quasi instantané sans I/O disque.
#[derive(RustEmbed)]
#[folder = "."]
#[include = "*.html"]
struct HtmlAssets;

// Une autre structure pour embarquer les fichiers du dossier `static` (CSS, JS, etc.).
// Le sous-dossier `static/vendor` contient les bibliothèques tierces (Bootstrap, Socket.IO, D3) :
// elles sont servies depuis le binaire, le dashboard fonctionne donc sans accès Internet.
#[derive(RustEmbed)]
#[folder = "static"]
struct StaticAssets;

// Les bibliothèques tierces sont figées à une version précise et ne changent jamais sans changer
// de nom de fichier : on peut donc autoriser une mise en cache très longue et « immutable », ce qui
// évite au navigateur de retélécharger ~630 Ko à chaque chargement de page.
const CACHE_IMMUABLE: &str = "public, max-age=31536000, immutable";
// Les fichiers de l'application (et le HTML) sont réécrits à chaque compilation. `no-cache`
// n'interdit pas la mise en cache : il impose une revalidation, qui se règle en 304 grâce à l'ETag.
const CACHE_REVALIDATION: &str = "no-cache";

// Construit une réponse HTTP à partir d'un fichier embarqué, en gérant la revalidation par ETag.
fn build_response(fichier: EmbeddedFile, path: &str, en_tetes: &HeaderMap) -> Response {
    // `rust-embed` calcule l'empreinte SHA-256 de chaque fichier à la compilation : elle constitue
    // un ETag fort et gratuit.
    let etag = format!("\"{}\"", hex(&fichier.metadata.sha256_hash()));

    // Si le client possède déjà cette version exacte, on répond 304 sans le corps.
    if let Some(if_none_match) = en_tetes.get(header::IF_NONE_MATCH) {
        if let Ok(valeur) = if_none_match.to_str() {
            // `If-None-Match` peut contenir plusieurs ETags séparés par des virgules.
            if valeur.split(',').any(|candidat| candidat.trim() == etag) {
                return Response::builder()
                    .status(StatusCode::NOT_MODIFIED)
                    .header(header::ETAG, &etag)
                    .body(Body::empty())
                    .unwrap();
            }
        }
    }

    // `mime_guess` détermine le type MIME du fichier à partir de son extension (ex: `text/html`, `text/css`).
    // C'est crucial pour que le navigateur interprète correctement le contenu.
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let cache = if path.starts_with("vendor/") {
        CACHE_IMMUABLE
    } else {
        CACHE_REVALIDATION
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, cache)
        .header(header::ETAG, etag)
        // `Body::from(...)` crée le corps de la réponse à partir des octets embarqués.
        .body(Body::from(fichier.data.into_owned()))
        .unwrap()
}

// Encode une empreinte binaire en hexadécimal minuscule.
fn hex(octets: &[u8]) -> String {
    use std::fmt::Write;
    let mut sortie = String::with_capacity(octets.len() * 2);
    for octet in octets {
        // L'écriture dans une `String` ne peut pas échouer.
        let _ = write!(sortie, "{:02x}", octet);
    }
    sortie
}

// Le handler Axum principal pour servir les fichiers embarqués.
// Il reçoit les en-têtes et l'URI demandée, et retourne la réponse appropriée.
pub async fn serve_embedded(en_tetes: HeaderMap, uri: Uri) -> Response {
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
        if let Some(fichier) = <HtmlAssets as RustEmbed>::get(path) {
            return build_response(fichier, path, &en_tetes);
        }
    }

    // Si ce n'est pas un HTML, tente de le trouver dans les `StaticAssets`.
    if path.starts_with("static/") {
        // On retire le préfixe "static/" pour correspondre au chemin dans le dossier `static`.
        // `rust-embed` indexe les sous-dossiers avec ce même séparateur : `vendor/d3.v7.min.js`.
        let chemin_static = path.strip_prefix("static/").unwrap_or(path);
        if let Some(fichier) = <StaticAssets as RustEmbed>::get(chemin_static) {
            return build_response(fichier, chemin_static, &en_tetes);
        }
    }

    // Si le fichier n'est trouvé dans aucun des conteneurs, retourne une erreur 404 Not Found.
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::from("404 Not Found"))
        .unwrap()
}
