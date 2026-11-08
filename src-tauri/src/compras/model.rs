//! Tipos do contrato (docs/compras.spec.md seção 4). Serde camelCase, dinheiro em centavos.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

macro_rules! str_enum {
    ($name:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $( #[serde(rename = $s)] $variant, )+
        }
        #[allow(dead_code)]
        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self { $( $name::$variant => $s, )+ }
            }
            pub fn parse(s: &str) -> Option<Self> {
                match s { $( $s => Some($name::$variant), )+ _ => None }
            }
        }
    };
}

str_enum!(OfferAdapter {
    Generic => "generic",
    Kabum => "kabum",
    Amazon => "amazon",
    Vtex => "vtex",
    MercadoLivre => "mercadolivre",
    Manual => "manual",
});

impl Default for OfferAdapter {
    fn default() -> Self {
        OfferAdapter::Generic
    }
}

str_enum!(OfferStatus {
    Pending => "pending",
    Ok => "ok",
    Manual => "manual",
    Suspect => "suspect",
    Blocked => "blocked",
    Broken => "broken",
    Paused => "paused",
});

str_enum!(ObsSource {
    Auto => "auto",
    Manual => "manual",
});

str_enum!(CashSource {
    Page => "page",
    Estimated => "estimated",
    List => "list",
});

str_enum!(Trend {
    Down => "down",
    Up => "up",
    Flat => "flat",
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecField {
    pub key: String,
    pub label: String,
    /// "text" | "number" | "bool" | "enum"
    pub kind: String,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTemplate {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub fields: Vec<SpecField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComprasItem {
    #[serde(default)]
    pub id: String,
    pub category: String,
    pub name: String,
    #[serde(default = "default_qty")]
    pub qty: i64,
    #[serde(default)]
    pub budget_unit_cents: Option<i64>,
    #[serde(default)]
    pub target_cents: Option<i64>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub bought: bool,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub specs: BTreeMap<String, String>,
    #[serde(default)]
    pub template_id: Option<String>,
    #[serde(default)]
    pub model_token: Option<String>,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_qty() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComprasOffer {
    #[serde(default)]
    pub id: String,
    pub item_id: String,
    pub store: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub sku: Option<String>,
    #[serde(default = "default_adapter")]
    pub adapter: OfferAdapter,
    #[serde(default)]
    pub shipping_cents: Option<i64>,
    #[serde(default)]
    pub shipping_note: Option<String>,
    #[serde(default)]
    pub pix_discount_pct: Option<f64>,
    #[serde(default = "default_status")]
    pub status: OfferStatus,
    #[serde(default)]
    pub fail_count: i64,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_checked_at: Option<String>,
    #[serde(default)]
    pub next_poll_at: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

fn default_adapter() -> OfferAdapter {
    OfferAdapter::Generic
}
fn default_status() -> OfferStatus {
    OfferStatus::Pending
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComprasObservation {
    pub id: String,
    pub offer_id: String,
    pub list_cents: Option<i64>,
    pub cash_cents: Option<i64>,
    pub installments_text: Option<String>,
    pub in_stock: Option<bool>,
    pub source: ObsSource,
    pub confirmed: bool,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComprasPurchase {
    pub item_id: String,
    pub paid_unit_cents: i64,
    #[serde(default)]
    pub shipping_cents: i64,
    #[serde(default)]
    pub store: String,
    #[serde(default)]
    pub purchased_at: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferView {
    #[serde(flatten)]
    pub offer: ComprasOffer,
    pub latest: Option<ComprasObservation>,
    pub effective_cash_cents: Option<i64>,
    pub cash_source: Option<CashSource>,
    pub final_cents: Option<i64>,
    pub shipping_known: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ItemStats {
    pub window_days: i64,
    pub samples: i64,
    pub min_cents: Option<i64>,
    pub max_cents: Option<i64>,
    pub mean_cents: Option<i64>,
    pub median_cents: Option<i64>,
    pub trimmed_mean_cents: Option<i64>,
    pub p25_cents: Option<i64>,
    pub p75_cents: Option<i64>,
    pub all_time_low_cents: Option<i64>,
    pub current_final_cents: Option<i64>,
    pub is_historical_low: bool,
    pub below_target: bool,
    pub above_median: bool,
    pub trend: Option<Trend>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemView {
    pub item: ComprasItem,
    pub image_file: Option<String>,
    pub offers: Vec<OfferView>,
    pub best: Option<OfferView>,
    pub stats: ItemStats,
    pub purchase: Option<ComprasPurchase>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryBudget {
    pub category: String,
    pub budget_cents: i64,
    pub bought_cents: i64,
    /// Compras: pago (qtd x pago + frete). Pendentes: qtd x melhor preço final (ou orçado).
    pub current_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetSummary {
    pub total_budget_cents: i64,
    pub bought_cents: i64,
    pub remaining_budget_cents: i64,
    pub remaining_at_current_cents: i64,
    pub priced_items: i64,
    pub pct_done: f64,
    pub items_total: i64,
    pub items_bought: i64,
    pub by_category: Vec<CategoryBudget>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub date: String,
    pub best_final_cents: Option<i64>,
    pub per_offer: BTreeMap<String, Option<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Extracted {
    pub url: String,
    pub store: String,
    pub adapter: OfferAdapter,
    pub title: Option<String>,
    pub image_url: Option<String>,
    pub list_cents: Option<i64>,
    pub cash_cents: Option<i64>,
    pub installments_text: Option<String>,
    pub in_stock: Option<bool>,
    pub sku: Option<String>,
    pub blocked: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub inserted: i64,
    pub updated: i64,
    pub skipped: i64,
    pub bought_imported: i64,
    pub total_budget_cents: i64,
    pub bought_cents: i64,
    pub remaining_budget_cents: i64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComprasSettings {
    pub poll_enabled: bool,
    pub poll_interval_minutes: i64,
    pub amazon_min_interval_minutes: i64,
    pub cep: Option<String>,
    pub pix_discount_by_store: BTreeMap<String, f64>,
}

impl Default for ComprasSettings {
    fn default() -> Self {
        ComprasSettings {
            poll_enabled: true,
            poll_interval_minutes: 120,
            amazon_min_interval_minutes: 360,
            cep: None,
            pix_discount_by_store: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PollStatus {
    pub running: bool,
    pub queued: i64,
    pub last_run_at: Option<String>,
}
