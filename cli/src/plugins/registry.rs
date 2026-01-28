use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::gen_id;
use crate::connection::{send_command, Response};
use crate::flags::Flags;

#[derive(Debug, Deserialize, Clone)]
pub struct ExtensionManifest {
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub entry: Option<String>,
    pub permissions: Option<Vec<String>>,
    pub commands: Vec<ExtensionCommand>,
    #[serde(rename = "minCliVersion")]
    pub min_cli_version: Option<String>,
    #[serde(rename = "maxCliVersion")]
    pub max_cli_version: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ExtensionCommand {
    pub name: String,
    pub description: Option<String>,
    pub args: Option<Vec<ExtensionArg>>,
    pub handler: ExtensionHandler,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ExtensionArg {
    pub name: String,
    #[serde(rename = "type")]
    pub arg_type: Option<String>,
    pub required: Option<bool>,
    pub default: Option<Value>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ExtensionHandler {
    #[serde(rename = "type")]
    pub handler_type: String,
    pub steps: Option<Vec<Value>>,
}

#[derive(Debug)]
pub enum ExtensionError {
    InvalidInvocation { message: String, usage: String },
    InvalidValue { message: String, usage: String },
    Io { message: String },
    CommandFailed { response: Response },
}

pub struct ExtensionRegistry {
    extensions: Vec<ExtensionManifest>,
}

impl ExtensionRegistry {
    pub fn load() -> ExtensionRegistry {
        let mut extensions = Vec::new();
        for root in discover_extension_roots() {
            load_extensions_from_root(&root, &mut extensions);
        }
        if let Ok(cwd) = env::current_dir() {
            load_extensions_from_node_modules(&cwd.join("node_modules"), &mut extensions);
        }
        ExtensionRegistry { extensions }
    }

    pub fn list(&self) -> Vec<&ExtensionManifest> {
        self.extensions.iter().collect()
    }

    pub fn find(&self, name: &str) -> Option<&ExtensionManifest> {
        self.extensions.iter().find(|ext| ext.name == name)
    }
}

pub fn print_extension_index(registry: &ExtensionRegistry) {
    let list = registry.list();
    if list.is_empty() {
        return;
    }
    println!();
    println!("Plugins:");
    for ext in list {
        let desc = ext.description.as_deref().unwrap_or("");
        if desc.is_empty() {
            println!("  {}", ext.name);
        } else {
            println!("  {:<12} {}", ext.name, desc);
        }
    }
}

pub fn print_extension_help(
    registry: &ExtensionRegistry,
    name: &str,
    prefix: Option<&str>,
) -> bool {
    let Some(ext) = registry.find(name) else {
        return false;
    };
    let prefix = prefix.unwrap_or("");

    if prefix.is_empty() {
        println!("Usage: agent-browser {} <command> [args]", ext.name);
        if let Some(desc) = &ext.description {
            println!();
            println!("{}", desc);
        }
        println!();
        println!("Commands:");
        for cmd in &ext.commands {
            let desc = cmd.description.as_deref().unwrap_or("");
            if desc.is_empty() {
                println!("  {}", cmd.name);
            } else {
                println!("  {:<18} {}", cmd.name, desc);
            }
        }
        return true;
    }

    if let Some(cmd) = ext.commands.iter().find(|c| c.name == prefix) {
        print_extension_command_help(ext, cmd);
        return true;
    }

    let matches: Vec<&ExtensionCommand> = ext
        .commands
        .iter()
        .filter(|c| c.name == prefix || c.name.starts_with(&format!("{}.", prefix)))
        .collect();

    if matches.is_empty() {
        return false;
    }

    println!("Usage: agent-browser {} <command> [args]", ext.name);
    println!();
    println!("Commands:");
    for cmd in matches {
        let desc = cmd.description.as_deref().unwrap_or("");
        if desc.is_empty() {
            println!("  {}", cmd.name);
        } else {
            println!("  {:<18} {}", cmd.name, desc);
        }
    }
    true
}

fn print_extension_command_help(ext: &ExtensionManifest, cmd: &ExtensionCommand) {
    let usage = build_usage(ext, cmd);
    println!("Usage: {}", usage);
    if let Some(desc) = &cmd.description {
        println!();
        println!("{}", desc);
    }
    if let Some(args) = &cmd.args {
        if !args.is_empty() {
            println!();
            println!("Arguments:");
            for arg in args {
                let arg_name = arg.name.as_str();
                let arg_desc = arg.description.as_deref().unwrap_or("");
                if arg_desc.is_empty() {
                    println!("  {}", arg_name);
                } else {
                    println!("  {:<12} {}", arg_name, arg_desc);
                }
            }
        }
    }
}

pub fn try_execute_extension(
    registry: &ExtensionRegistry,
    args: &[String],
    flags: &Flags,
    session: &str,
) -> Result<Option<Response>, ExtensionError> {
    let Some((ext, cmd, arg_values)) = resolve_invocation(registry, args)? else {
        return Ok(None);
    };
    let response = execute_extension_command(ext, cmd, &arg_values, flags, session)?;
    Ok(Some(response))
}

fn resolve_invocation<'a>(
    registry: &'a ExtensionRegistry,
    args: &[String],
) -> Result<Option<(&'a ExtensionManifest, &'a ExtensionCommand, HashMap<String, Value>)>, ExtensionError>
{
    if args.len() < 2 {
        return Ok(None);
    }
    let ext_name = &args[0];
    let subcommand = &args[1];
    let Some(ext) = registry.find(ext_name) else {
        return Ok(None);
    };
    let Some(cmd) = ext.commands.iter().find(|c| c.name == subcommand.as_str()) else {
        let usage = format!("agent-browser {} <command> [args]", ext.name);
        return Err(ExtensionError::InvalidInvocation {
            message: format!("Unknown subcommand: {}", subcommand),
            usage,
        });
    };

    let arg_defs = cmd.args.as_deref().unwrap_or(&[]);
    let provided = &args[2..];
    let arg_values = parse_args(ext, cmd, arg_defs, provided)?;
    Ok(Some((ext, cmd, arg_values)))
}

fn execute_extension_command(
    ext: &ExtensionManifest,
    cmd: &ExtensionCommand,
    args: &HashMap<String, Value>,
    _flags: &Flags,
    session: &str,
) -> Result<Response, ExtensionError> {
    match cmd.handler.handler_type.as_str() {
        "macro" => {
            let Some(steps) = &cmd.handler.steps else {
                return Err(ExtensionError::InvalidInvocation {
                    message: "Macro handler missing steps".to_string(),
                    usage: build_usage(ext, cmd),
                });
            };

            let mut last_response = Response::default();
            for step in steps {
                let mut rendered = interpolate_value(step, args);
                ensure_command_id(&mut rendered);
                if !rendered.get("action").is_some() {
                    return Err(ExtensionError::InvalidInvocation {
                        message: "Macro step missing action field".to_string(),
                        usage: build_usage(ext, cmd),
                    });
                }
                let response = send_command(rendered, session).map_err(|e| ExtensionError::Io {
                    message: e,
                })?;
                if !response.success {
                    return Err(ExtensionError::CommandFailed { response });
                }
                last_response = response;
            }
            Ok(last_response)
        }
        "daemon" => {
            let rendered = json!({
                "id": gen_id(),
                "action": "extension",
                "extension": ext.name,
                "command": cmd.name,
                "args": args
            });
            let response = send_command(rendered, session).map_err(|e| ExtensionError::Io {
                message: e,
            })?;
            if !response.success {
                return Err(ExtensionError::CommandFailed { response });
            }
            Ok(response)
        }
        other => Err(ExtensionError::InvalidInvocation {
            message: format!("Unsupported handler type: {}", other),
            usage: build_usage(ext, cmd),
        }),
    }
}

fn ensure_command_id(value: &mut Value) {
    let Some(obj) = value.as_object_mut() else {
        return;
    };
    if !obj.contains_key("id") {
        obj.insert("id".to_string(), Value::String(gen_id()));
    }
}

fn parse_args(
    ext: &ExtensionManifest,
    cmd: &ExtensionCommand,
    defs: &[ExtensionArg],
    provided: &[String],
) -> Result<HashMap<String, Value>, ExtensionError> {
    let usage = build_usage(ext, cmd);
    if provided.len() > defs.len() {
        return Err(ExtensionError::InvalidInvocation {
            message: "Too many arguments".to_string(),
            usage,
        });
    }

    let mut values = HashMap::new();
    for (idx, def) in defs.iter().enumerate() {
        let required = def.required.unwrap_or(true);
        let value = if let Some(raw) = provided.get(idx) {
            parse_arg_value(def, raw, &usage)?
        } else if let Some(default) = &def.default {
            default.clone()
        } else if required {
            return Err(ExtensionError::InvalidInvocation {
                message: format!("Missing argument: {}", def.name),
                usage,
            });
        } else {
            continue;
        };
        values.insert(def.name.clone(), value);
    }
    Ok(values)
}

fn parse_arg_value(def: &ExtensionArg, raw: &str, usage: &str) -> Result<Value, ExtensionError> {
    let arg_type = def.arg_type.as_deref().unwrap_or("string");
    match arg_type {
        "int" => raw.parse::<i64>().map(Value::from).map_err(|_| {
            ExtensionError::InvalidValue {
                message: format!("Invalid int for {}", def.name),
                usage: usage.to_string(),
            }
        }),
        "number" => raw.parse::<f64>().map(Value::from).map_err(|_| {
            ExtensionError::InvalidValue {
                message: format!("Invalid number for {}", def.name),
                usage: usage.to_string(),
            }
        }),
        "bool" => raw.parse::<bool>().map(Value::from).map_err(|_| {
            ExtensionError::InvalidValue {
                message: format!("Invalid bool for {}", def.name),
                usage: usage.to_string(),
            }
        }),
        _ => Ok(Value::String(raw.to_string())),
    }
}

fn build_usage(ext: &ExtensionManifest, cmd: &ExtensionCommand) -> String {
    let mut usage = format!("agent-browser {} {}", ext.name, cmd.name);
    if let Some(args) = &cmd.args {
        for arg in args {
            let required = arg.required.unwrap_or(true);
            if required {
                usage.push_str(&format!(" <{}>", arg.name));
            } else {
                usage.push_str(&format!(" [{}]", arg.name));
            }
        }
    }
    usage
}

fn interpolate_value(value: &Value, args: &HashMap<String, Value>) -> Value {
    match value {
        Value::String(s) => interpolate_string(s, args),
        Value::Array(items) => Value::Array(items.iter().map(|v| interpolate_value(v, args)).collect()),
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                out.insert(k.clone(), interpolate_value(v, args));
            }
            Value::Object(out)
        }
        _ => value.clone(),
    }
}

fn interpolate_string(s: &str, args: &HashMap<String, Value>) -> Value {
    if let Some(key) = exact_placeholder(s) {
        if let Some(value) = args.get(key) {
            return value.clone();
        }
    }
    let mut out = s.to_string();
    for (key, value) in args {
        let placeholder = format!("{{{{{}}}}}", key);
        if out.contains(&placeholder) {
            let replacement = match value {
                Value::String(s) => s.clone(),
                _ => value.to_string(),
            };
            out = out.replace(&placeholder, &replacement);
        }
    }
    Value::String(out)
}

fn exact_placeholder(s: &str) -> Option<&str> {
    if s.starts_with("{{") && s.ends_with("}}") && s.len() > 4 {
        return Some(&s[2..s.len() - 2]);
    }
    None
}

fn discover_extension_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = env::var("AGENT_BROWSER_PLUGINS_DIR") {
        if !dir.is_empty() {
            roots.push(PathBuf::from(dir));
        }
    }
    if let Ok(dir) = env::var("AGENT_BROWSER_EXTENSIONS_DIR") {
        if !dir.is_empty() {
            roots.push(PathBuf::from(dir));
        }
    }
    if let Ok(cwd) = env::current_dir() {
        roots.push(cwd.join(".agent-browser").join("plugins"));
        roots.push(cwd.join(".agent-browser").join("extensions"));
    }
    if let Some(config) = dirs::config_dir() {
        roots.push(config.join("agent-browser").join("plugins"));
        roots.push(config.join("agent-browser").join("extensions"));
    }
    roots
}

fn load_extensions_from_root(root: &Path, out: &mut Vec<ExtensionManifest>) {
    if !root.exists() {
        return;
    }

    if let Some(manifest) = load_manifest(&root.join("extension.json")) {
        out.push(manifest);
    }

    let node_modules = root.join("node_modules");
    load_extensions_from_node_modules(&node_modules, out);

    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("extension.json");
        if let Some(manifest) = load_manifest(&manifest_path) {
            out.push(manifest);
        }
    }
}

fn load_extensions_from_node_modules(root: &Path, out: &mut Vec<ExtensionManifest>) {
    if !root.exists() {
        return;
    }

    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('@') && path.is_dir() {
            let Ok(scope_entries) = fs::read_dir(&path) else {
                continue;
            };
            for scope_entry in scope_entries.flatten() {
                let pkg_path = scope_entry.path();
                let pkg_name = scope_entry.file_name().to_string_lossy().to_string();
                if is_plugin_package_name(&format!("{}/{}", name, pkg_name)) {
                    if let Some(manifest) = load_manifest(&pkg_path.join("extension.json")) {
                        out.push(manifest);
                    }
                }
            }
            continue;
        }

        if path.is_dir() && is_plugin_package_name(&name) {
            if let Some(manifest) = load_manifest(&path.join("extension.json")) {
                out.push(manifest);
            }
        }
    }
}

fn is_plugin_package_name(name: &str) -> bool {
    if let Some(base) = strip_package_version(name) {
        if let Some((scope, pkg)) = base.split_once('/') {
            if !scope.starts_with('@') {
                return false;
            }
            return pkg.starts_with("agent-browser-plugin-");
        }
        return base.starts_with("agent-browser-plugin-");
    }
    false
}

fn strip_package_version(name: &str) -> Option<&str> {
    if name.starts_with('@') {
        let Some(slash) = name.find('/') else {
            return None;
        };
        let rest = &name[slash + 1..];
        if let Some(at) = rest.rfind('@') {
            let end = slash + 1 + at;
            return Some(&name[..end]);
        }
        return Some(name);
    }
    if let Some(at) = name.rfind('@') {
        return Some(&name[..at]);
    }
    Some(name)
}

fn load_manifest(path: &Path) -> Option<ExtensionManifest> {
    let Ok(raw) = fs::read_to_string(path) else {
        return None;
    };
    serde_json::from_str::<ExtensionManifest>(&raw).ok()
}
