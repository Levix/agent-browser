pub mod commands;
pub mod registry;

pub use commands::run_plugins;
pub use registry::{
    print_plugin_help, print_plugin_index, try_execute_plugin, PluginError,
    PluginRegistry,
};
