pub mod commands;
pub mod registry;

pub use commands::run_plugins;
pub use registry::{
    print_extension_help, print_extension_index, try_execute_extension, ExtensionError,
    ExtensionRegistry,
};
