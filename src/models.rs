// Ce fichier définit les structures de données (modèles) utilisées dans l'application.
// Elles sont utilisées pour la sérialisation/désérialisation JSON et pour typer les données en mémoire.
use serde::{Deserialize, Serialize};

// `#[derive(Debug, Clone, Serialize, Deserialize)]`:
// - `Debug`: Permet d'afficher la structure avec `println!("{:?}", ...)`.
// - `Clone`: Permet de créer des copies de la structure.
// - `Serialize`: Permet de convertir la structure en JSON.
// - `Deserialize`: Permet de convertir du JSON en cette structure.

// Représente une requête de publication reçue par l'API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishRequest {
    pub topic: String,
    pub message_id: String,
    // `serde_json::Value`: Type flexible pour représenter n'importe quelle donnée JSON valide.
    pub message: serde_json::Value,
    pub producer: String,
}

// Informations sur un client connecté.
#[derive(Debug, Clone, Serialize)]
pub struct ClientInfo {
    pub consumer: String,
    pub topic: String,
    pub connected_at: f64,
}

// Informations sur un message stocké.
#[derive(Debug, Clone, Serialize)]
pub struct MessageInfo {
    pub topic: String,
    pub message_id: String,
    pub message: serde_json::Value,
    pub producer: String,
    pub timestamp: f64,
}

// Informations sur une consommation de message.
#[derive(Debug, Clone, Serialize)]
pub struct ConsumptionInfo {
    pub consumer: String,
    pub topic: String,
    pub message_id: String,
    pub message: serde_json::Value,
    pub timestamp: f64,
}

// État complet du graphe pour l'affichage du tableau de bord.
#[derive(Debug, Clone, Serialize)]
pub struct GraphState {
    pub producers: Vec<String>,
    pub consumers: Vec<String>,
    pub topics: Vec<String>,
    pub links: Vec<Link>,
}

// Représente un lien dans le graphe (ex: producteur -> sujet).
#[derive(Debug, Clone, Serialize)]
pub struct Link {
    pub source: String,
    pub target: String,
    // `#[serde(rename = "type")]`: Renomme le champ `link_type` en `type` dans le JSON final,
    // car `type` est un mot-clé réservé en Rust.
    #[serde(rename = "type")]
    pub link_type: String,
}

// État de santé de l'application.
#[derive(Debug, Clone, Serialize)]
pub struct HealthStatus {
    pub status: String,
    pub timestamp: f64,
}

// Message WebSocket pour s'abonner à des sujets.
#[derive(Debug, Deserialize)]
pub struct SubscribeMessage {
    pub consumer: String,
    pub topics: Vec<String>,
}

// Message WebSocket confirmant la consommation d'un message.
#[derive(Debug, Deserialize)]
pub struct ConsumedMessage {
    pub consumer: String,
    pub topic: String,
    pub message_id: String,
    pub message: serde_json::Value,
}

// Événement générique à diffuser via le `Broker`.
#[derive(Debug, Clone, Serialize)]
pub struct BroadcastEvent {
    pub event_type: String,
    pub data: serde_json::Value,
}
