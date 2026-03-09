pub mod commands;
pub mod registry;

use crate::output::register_external_help_provider;

pub use commands::run_plugins;
pub use registry::{
    print_plugin_help, print_plugin_index, try_execute_plugin, PluginError,
    PluginRegistry,
};

pub fn register_plugin_output_hooks() {
    register_external_help_provider(registry::resolve_plugin_command_help);
}
