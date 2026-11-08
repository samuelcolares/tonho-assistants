//! VTEX (Sam's Club, Fast Shop, Carrefour): JSON-LD Product/Offer ou AggregateOffer (lowPrice).

use super::jsonld;
use crate::compras::model::Extracted;
use scraper::Html;

pub fn extract(doc: &Html) -> Option<Extracted> {
    jsonld::extract(doc)
}
