use super::Finding;
use std::path::Path;

pub trait FileRule {
    fn check(&self, path: &Path) -> Vec<Finding>;
}
