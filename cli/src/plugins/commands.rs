use crate::color;
use super::registry::ExtensionRegistry;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{exit, Command};

pub fn run_plugins(args: &[String], json_mode: bool) {
    if args.len() < 2 {
        print_plugins_help();
        exit(1);
    }

    match args[1].as_str() {
        "add" => run_add(&args[2..], json_mode),
        "init" => run_init(&args[2..], json_mode),
        "remove" => run_remove(&args[2..], json_mode),
        "list" => run_list(json_mode),
        "info" => run_info(&args[2..], json_mode),
        _ => {
            if json_mode {
                println!(r#"{{"success":false,"error":"Unknown plugins subcommand"}}"#);
            } else {
                eprintln!("{}", color::red("Unknown plugins subcommand"));
                print_plugins_help();
            }
            exit(1);
        }
    }
}

fn run_add(args: &[String], json_mode: bool) {
    let opts = match parse_add_args(args) {
        Ok(v) => v,
        Err(err) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#, err.replace('"', "'"));
            } else {
                eprintln!("{}", color::red(&err));
                print_plugins_add_help();
            }
            exit(1);
        }
    };

    let command_str = opts.command.join(" ");
    if let Some(src_path) = extract_local_path(&opts.command) {
        install_from_path(&src_path, opts.location, json_mode);
        return;
    }

    let package = match extract_plugin_package(&opts.command) {
        Some(pkg) => pkg,
        None => {
            let msg =
                "No plugin package found. Package must match agent-browser-plugin-* or @scope/agent-browser-plugin-*";
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#, msg);
            } else {
                eprintln!("{}", color::red(msg));
            }
            exit(1);
        }
    };

    let root = match resolve_plugins_root(opts.location) {
        Ok(path) => path,
        Err(err) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#, err);
            } else {
                eprintln!("{} {}", color::error_indicator(), err);
            }
            exit(1);
        }
    };

    let dir_name = sanitize_plugin_dir(&package);
    let target_dir = root.join(&dir_name);
    if let Err(err) = fs::create_dir_all(&target_dir) {
        if json_mode {
            println!(r#"{{"success":false,"error":"{}"}}"#, err);
        } else {
            eprintln!("{} {}", color::error_indicator(), err);
        }
        exit(1);
    }

    let status = run_shell_command(&command_str, &target_dir);
    match status {
        Ok(true) => {
            let has_manifest = find_manifest(&target_dir).is_some();
            if json_mode {
                println!(
                    "{}",
                    json!({
                        "success": true,
                        "data": {
                            "package": package,
                            "dir": target_dir.display().to_string(),
                            "command": command_str,
                            "manifest": has_manifest
                        }
                    })
                );
            } else {
                println!(
                    "{} Plugin installed: {}",
                    color::success_indicator(),
                    package
                );
                println!("  {}", target_dir.display());
                if !has_manifest {
                    eprintln!(
                        "{} No extension.json found after install. Plugin may be incomplete.",
                        color::warning_indicator()
                    );
                }
            }
        }
        Ok(false) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"Install command failed"}}"#);
            } else {
                eprintln!("{} Install command failed", color::error_indicator());
            }
            exit(1);
        }
        Err(err) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#, err);
            } else {
                eprintln!("{} {}", color::error_indicator(), err);
            }
            exit(1);
        }
    }
}

fn run_list(json_mode: bool) {
    let registry = ExtensionRegistry::load();
    let list = registry.list();
    if json_mode {
        let names: Vec<&str> = list.iter().map(|ext| ext.name.as_str()).collect();
        println!("{}", json!({ "success": true, "data": { "plugins": names } }));
        return;
    }
    if list.is_empty() {
        println!("No plugins found");
        return;
    }
    println!("Plugins:");
    for ext in list {
        if let Some(desc) = &ext.description {
            println!("  {:<12} {}", ext.name, desc);
        } else {
            println!("  {}", ext.name);
        }
    }
}

fn run_info(args: &[String], json_mode: bool) {
    let Some(name) = args.get(0) else {
        if json_mode {
            println!(r#"{{"success":false,"error":"Missing plugin name"}}"#);
        } else {
            eprintln!("{}", color::red("Missing plugin name"));
            print_plugins_info_help();
        }
        exit(1);
    };
    let registry = ExtensionRegistry::load();
    let Some(ext) = registry.find(name) else {
        if json_mode {
            println!(r#"{{"success":false,"error":"Plugin not found"}}"#);
        } else {
            eprintln!("{} Plugin not found", color::error_indicator());
        }
        exit(1);
    };
    if json_mode {
        println!(
            "{}",
            json!({
                "success": true,
                "data": {
                    "name": ext.name,
                    "description": ext.description,
                    "version": ext.version,
                    "entry": ext.entry,
                    "permissions": ext.permissions,
                    "min_cli_version": ext.min_cli_version,
                    "max_cli_version": ext.max_cli_version
                }
            })
        );
    } else {
        println!("{}", ext.name);
        if let Some(desc) = &ext.description {
            println!("  {}", desc);
        }
        if let Some(ver) = &ext.version {
            println!("  version: {}", ver);
        }
        if let Some(entry) = &ext.entry {
            println!("  entry: {}", entry);
        }
        if let Some(perms) = &ext.permissions {
            if !perms.is_empty() {
                println!("  permissions: {}", perms.join(", "));
            }
        }
        if let Some(min) = &ext.min_cli_version {
            println!("  min cli: {}", min);
        }
        if let Some(max) = &ext.max_cli_version {
            println!("  max cli: {}", max);
        }
    }
}

fn print_plugins_help() {
    println!("Usage: agent-browser plugins <add|init|remove|list|info> [args]");
}

fn print_plugins_add_help() {
    println!("Usage: agent-browser plugins add [--user|--local|--dir <path>] <command...>");
    println!("Example:");
    println!("  agent-browser plugins add --user npx @scope/agent-browser-plugin-example");
    println!("  agent-browser plugins add --local ./my-plugins/agent-browser-plugin-example");
}

fn print_plugins_init_help() {
    println!("Usage: agent-browser plugins init [--user|--local|--dir <path>] <name>");
    println!("Example:");
    println!("  agent-browser plugins init --local example");
}

fn print_plugins_info_help() {
    println!("Usage: agent-browser plugins info <name>");
}

fn print_plugins_remove_help() {
    println!("Usage: agent-browser plugins remove [--user|--local|--dir <path>] <name>");
    println!("Example:");
    println!("  agent-browser plugins remove --user example");
}

#[derive(Clone)]
enum PluginLocation {
    User,
    Local,
    Custom(PathBuf),
    Auto,
}

struct AddOptions {
    command: Vec<String>,
    location: PluginLocation,
}

fn parse_add_args(args: &[String]) -> Result<AddOptions, String> {
    let mut location: Option<PluginLocation> = None;
    let mut command: Vec<String> = Vec::new();
    let mut i = 0;
    let mut in_command = false;

    while i < args.len() {
        let token = args[i].as_str();
        if !in_command {
            match token {
                "--" => {
                    in_command = true;
                    i += 1;
                    continue;
                }
                "--user" => {
                    if location.is_some() {
                        return Err("Only one of --user, --local, or --dir is allowed".to_string());
                    }
                    location = Some(PluginLocation::User);
                    i += 1;
                    continue;
                }
                "--local" => {
                    if location.is_some() {
                        return Err("Only one of --user, --local, or --dir is allowed".to_string());
                    }
                    location = Some(PluginLocation::Local);
                    i += 1;
                    continue;
                }
                "--dir" => {
                    if location.is_some() {
                        return Err("Only one of --user, --local, or --dir is allowed".to_string());
                    }
                    let Some(dir) = args.get(i + 1) else {
                        return Err("Missing value for --dir".to_string());
                    };
                    location = Some(PluginLocation::Custom(PathBuf::from(dir)));
                    i += 2;
                    continue;
                }
                _ => {
                    in_command = true;
                }
            }
        }

        if in_command {
            command.extend_from_slice(&args[i..]);
            break;
        }
    }

    if command.is_empty() {
        return Err("Missing install command".to_string());
    }

    Ok(AddOptions {
        command,
        location: location.unwrap_or(PluginLocation::User),
    })
}

struct InitOptions {
    name: String,
    location: PluginLocation,
}

fn parse_init_args(args: &[String]) -> Result<InitOptions, String> {
    let mut location: Option<PluginLocation> = None;
    let mut name: Option<String> = None;
    let mut i = 0;

    while i < args.len() {
        let token = args[i].as_str();
        match token {
            "--user" => {
                if location.is_some() {
                    return Err("Only one of --user, --local, or --dir is allowed".to_string());
                }
                location = Some(PluginLocation::User);
                i += 1;
            }
            "--local" => {
                if location.is_some() {
                    return Err("Only one of --user, --local, or --dir is allowed".to_string());
                }
                location = Some(PluginLocation::Local);
                i += 1;
            }
            "--dir" => {
                if location.is_some() {
                    return Err("Only one of --user, --local, or --dir is allowed".to_string());
                }
                let Some(dir) = args.get(i + 1) else {
                    return Err("Missing value for --dir".to_string());
                };
                location = Some(PluginLocation::Custom(PathBuf::from(dir)));
                i += 2;
            }
            _ => {
                if name.is_some() {
                    return Err("Only one plugin name is allowed".to_string());
                }
                name = Some(token.to_string());
                i += 1;
            }
        }
    }

    let Some(name) = name else {
        return Err("Missing plugin name".to_string());
    };

    Ok(InitOptions {
        name,
        location: location.unwrap_or(PluginLocation::User),
    })
}

fn parse_remove_args(args: &[String]) -> Result<InitOptions, String> {
    let mut location: Option<PluginLocation> = None;
    let mut name: Option<String> = None;
    let mut i = 0;

    while i < args.len() {
        let token = args[i].as_str();
        match token {
            "--user" => {
                if location.is_some() {
                    return Err("Only one of --user, --local, or --dir is allowed".to_string());
                }
                location = Some(PluginLocation::User);
                i += 1;
            }
            "--local" => {
                if location.is_some() {
                    return Err("Only one of --user, --local, or --dir is allowed".to_string());
                }
                location = Some(PluginLocation::Local);
                i += 1;
            }
            "--dir" => {
                if location.is_some() {
                    return Err("Only one of --user, --local, or --dir is allowed".to_string());
                }
                let Some(dir) = args.get(i + 1) else {
                    return Err("Missing value for --dir".to_string());
                };
                location = Some(PluginLocation::Custom(PathBuf::from(dir)));
                i += 2;
            }
            _ => {
                if name.is_some() {
                    return Err("Only one plugin name is allowed".to_string());
                }
                name = Some(token.to_string());
                i += 1;
            }
        }
    }

    let Some(name) = name else {
        return Err("Missing plugin name".to_string());
    };

    Ok(InitOptions {
        name,
        location: location.unwrap_or(PluginLocation::Auto),
    })
}

fn resolve_plugins_root(location: PluginLocation) -> Result<PathBuf, String> {
    match location {
        PluginLocation::Custom(path) => Ok(path),
        PluginLocation::Local => {
            let cwd = env::current_dir().map_err(|e| e.to_string())?;
            Ok(cwd.join(".agent-browser").join("plugins"))
        }
        PluginLocation::User => {
            let Some(config) = dirs::config_dir() else {
                return Err("Could not resolve user config directory".to_string());
            };
            Ok(config.join("agent-browser").join("plugins"))
        }
        PluginLocation::Auto => {
            let cwd = env::current_dir().map_err(|e| e.to_string())?;
            let local = cwd.join(".agent-browser").join("plugins");
            if local.exists() {
                return Ok(local);
            }
            let Some(config) = dirs::config_dir() else {
                return Err("Could not resolve user config directory".to_string());
            };
            Ok(config.join("agent-browser").join("plugins"))
        }
    }
}

fn run_init(args: &[String], json_mode: bool) {
    let opts = match parse_init_args(args) {
        Ok(v) => v,
        Err(err) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#,
                         err.replace('"', "'"));
            } else {
                eprintln!("{}", color::red(&err));
                print_plugins_init_help();
            }
            exit(1);
        }
    };

    let root = match resolve_plugins_root(opts.location) {
        Ok(path) => path,
        Err(err) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#,
                         err.replace('"', "'"));
            } else {
                eprintln!("{} {}", color::error_indicator(), err);
            }
            exit(1);
        }
    };

    let plugin_dir = root.join(&opts.name);
    let src_dir = plugin_dir.join("src");
    if let Err(err) = fs::create_dir_all(&src_dir) {
        if json_mode {
            println!(r#"{{"success":false,"error":"{}"}}"#,
                     err.to_string().replace('"', "'"));
        } else {
            eprintln!("{} {}", color::error_indicator(), err);
        }
        exit(1);
    }

    let extension_json = plugin_dir.join("extension.json");
    let tsconfig = plugin_dir.join("tsconfig.json");
    let readme = plugin_dir.join("README.md");
    let index_ts = src_dir.join("index.ts");

    if let Err(err) = fs::write(&extension_json, default_extension_json(&opts.name)) {
        handle_fs_error(err, json_mode);
    }
    if let Err(err) = fs::write(&tsconfig, default_tsconfig()) {
        handle_fs_error(err, json_mode);
    }
    if let Err(err) = fs::write(&readme, default_readme(&opts.name)) {
        handle_fs_error(err, json_mode);
    }
    if let Err(err) = fs::write(&index_ts, default_index_ts()) {
        handle_fs_error(err, json_mode);
    }

    if json_mode {
        println!(
            "{}",
            json!({
                "success": true,
                "data": {
                    "name": opts.name,
                    "dir": plugin_dir.display().to_string()
                }
            })
        );
    } else {
        println!(
            "{} Plugin scaffold created",
            color::success_indicator()
        );
        println!("  {}", plugin_dir.display());
        println!("  Build: tsc -p {}", tsconfig.display());
    }
}

fn run_remove(args: &[String], json_mode: bool) {
    let opts = match parse_remove_args(args) {
        Ok(v) => v,
        Err(err) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#, err.replace('"', "'"));
            } else {
                eprintln!("{}", color::red(&err));
                print_plugins_remove_help();
            }
            exit(1);
        }
    };

    let location = opts.location.clone();
    let root = match resolve_plugins_root(location.clone()) {
        Ok(path) => path,
        Err(err) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#, err);
            } else {
                eprintln!("{} {}", color::error_indicator(), err);
            }
            exit(1);
        }
    };

    let mut plugin_dir = root.join(&opts.name);
    if !plugin_dir.exists() && matches!(location, PluginLocation::Auto) {
        if let Ok(user_root) = resolve_plugins_root(PluginLocation::User) {
            let candidate = user_root.join(&opts.name);
            if candidate.exists() {
                plugin_dir = candidate;
            }
        }
    }

    if !plugin_dir.exists() {
        if json_mode {
            println!(r#"{{"success":false,"error":"Plugin not found"}}"#);
        } else {
            eprintln!("{} Plugin not found", color::error_indicator());
        }
        exit(1);
    }

    let uninstall_result = try_uninstall_plugin(&plugin_dir, &opts.name);

    if let Err(err) = fs::remove_dir_all(&plugin_dir) {
        if json_mode {
            println!(r#"{{"success":false,"error":"{}"}}"#, err.to_string().replace('"', "'"));
        } else {
            eprintln!("{} {}", color::error_indicator(), err);
        }
        exit(1);
    }

    if json_mode {
        println!(
            "{}",
            json!({
                "success": true,
                "data": {
                    "name": opts.name,
                    "dir": plugin_dir.display().to_string(),
                    "uninstall": uninstall_result
                }
            })
        );
    } else {
        println!("{} Plugin removed", color::success_indicator());
        println!("  {}", plugin_dir.display());
        if let Some(result) = uninstall_result {
            if result.success {
                println!("  Uninstalled: {}", result.package);
            } else {
                eprintln!(
                    "{} Uninstall failed: {}",
                    color::warning_indicator(),
                    result.package
                );
            }
        }
    }
}

#[derive(serde::Serialize)]
struct UninstallResult {
    package: String,
    success: bool,
}

fn try_uninstall_plugin(dir: &Path, plugin_name: &str) -> Option<UninstallResult> {
    let package = find_installed_plugin_package(dir, plugin_name)?;
    let manager = detect_package_manager(dir);
    let uninstall_cmd = match manager.as_deref() {
        Some("pnpm") => format!("pnpm remove {}", package),
        Some("yarn") => format!("yarn remove {}", package),
        Some("bun") => format!("bun remove {}", package),
        _ => format!("npm uninstall {}", package),
    };

    match run_shell_command(&uninstall_cmd, dir) {
        Ok(success) => Some(UninstallResult { package, success }),
        Err(_) => Some(UninstallResult {
            package,
            success: false,
        }),
    }
}

fn find_installed_plugin_package(dir: &Path, plugin_name: &str) -> Option<String> {
    let package_json = dir.join("package.json");
    if !package_json.exists() {
        return None;
    }
    let raw = fs::read_to_string(&package_json).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;

    let mut candidates = Vec::new();
    for key in ["dependencies", "devDependencies", "optionalDependencies"] {
        if let Some(deps) = parsed.get(key).and_then(|v| v.as_object()) {
            for (name, _) in deps {
                if is_plugin_package_name(name) {
                    candidates.push(name.clone());
                }
            }
        }
    }

    if candidates.is_empty() {
        if let Some(name) = parsed.get("name").and_then(|v| v.as_str()) {
            if is_plugin_package_name(name) && package_name_matches_plugin(name, plugin_name) {
                return Some(name.to_string());
            }
        }
        return None;
    }

    if let Some(match_name) = candidates
        .iter()
        .find(|name| package_name_matches_plugin(name, plugin_name))
    {
        return Some((*match_name).to_string());
    }

    candidates.into_iter().next()
}

fn package_name_matches_plugin(package: &str, plugin_name: &str) -> bool {
    if let Some((_, pkg)) = package.split_once('/') {
        return pkg.ends_with(plugin_name);
    }
    package.ends_with(plugin_name)
}

fn detect_package_manager(dir: &Path) -> Option<&'static str> {
    if dir.join("pnpm-lock.yaml").exists() {
        return Some("pnpm");
    }
    if dir.join("yarn.lock").exists() {
        return Some("yarn");
    }
    if dir.join("bun.lockb").exists() {
        return Some("bun");
    }
    if dir.join("package-lock.json").exists() {
        return Some("npm");
    }
    None
}

fn handle_fs_error(err: std::io::Error, json_mode: bool) {
    if json_mode {
        println!(r#"{{"success":false,"error":"{}"}}"#, err.to_string().replace('"', "'"));
    } else {
        eprintln!("{} {}", color::error_indicator(), err);
    }
    exit(1);
}

fn default_extension_json(name: &str) -> String {
    let template = format!(
        r#"{{
  "name": "{name}",
  "version": "0.1.0",
  "description": "Plugin description",
  "entry": "./dist/index.js",
  "permissions": [],
  "commands": [
    {{
      "name": "example.hello",
      "description": "Example command",
      "args": [
        {{ "name": "selector", "type": "string", "required": true, "description": "CSS selector" }}
      ],
      "handler": {{ "type": "daemon" }}
    }}
  ],
  "minCliVersion": "0.8.4"
}}
"#,
        name = name
    );
    template
}

fn default_tsconfig() -> String {
    r#"{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts"]
}
"#
    .to_string()
}

fn default_readme(name: &str) -> String {
    format!(
        r#"# {name}

Quick start:

1) Build
   tsc -p ./tsconfig.json

2) Run
   agent-browser {name} example.hello ".selector"
"#,
        name = name
    )
}

fn default_index_ts() -> String {
    r#"import type { Page } from 'playwright-core';

type ExtensionContext = {
  page: Page;
};

type ExtensionCommandHandler = (
  ctx: ExtensionContext,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

const hello: ExtensionCommandHandler = async ({ page }, args) => {
  const selector = String(args.selector ?? '');
  if (!selector) {
    throw new Error('selector is required');
  }
  const text = await page.locator(selector).innerText();
  return { text };
};

export const commands: Record<string, ExtensionCommandHandler> = {
  'example.hello': hello,
};
"#
    .to_string()
}
fn run_shell_command(command: &str, dir: &Path) -> Result<bool, String> {
    #[cfg(windows)]
    let status = Command::new("cmd")
        .args(["/c", command])
        .current_dir(dir)
        .env("AGENT_BROWSER_PLUGIN_DIR", dir)
        .status();

    #[cfg(not(windows))]
    let status = Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(dir)
        .env("AGENT_BROWSER_PLUGIN_DIR", dir)
        .status();

    match status {
        Ok(s) => Ok(s.success()),
        Err(e) => Err(e.to_string()),
    }
}

fn extract_local_path(command: &[String]) -> Option<PathBuf> {
    if command.len() != 1 {
        return None;
    }
    let raw = trim_quotes(&command[0]);
    let path = PathBuf::from(raw);
    if path.exists() {
        return Some(path);
    }
    None
}

fn extract_plugin_package(command: &[String]) -> Option<String> {
    for token in command {
        let trimmed = trim_quotes(token);
        if let Some(base) = strip_package_version(trimmed) {
            if is_plugin_package_name(base) {
                return Some(base.to_string());
            }
        }
    }
    None
}

fn trim_quotes(token: &str) -> &str {
    token.trim_matches('"').trim_matches('\'')
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

fn is_plugin_package_name(name: &str) -> bool {
    if let Some((scope, pkg)) = name.split_once('/') {
        if !scope.starts_with('@') {
            return false;
        }
        return pkg.starts_with("agent-browser-plugin-");
    }
    name.starts_with("agent-browser-plugin-")
}

fn sanitize_plugin_dir(name: &str) -> String {
    let without_at = name.trim_start_matches('@');
    without_at.replace('/', "__")
}

fn find_manifest(root: &Path) -> Option<PathBuf> {
    let direct = root.join("extension.json");
    if direct.exists() {
        return Some(direct);
    }
    let node_modules = root.join("node_modules");
    find_manifest_in_node_modules(&node_modules)
}

fn find_manifest_in_node_modules(root: &Path) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return None;
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
                if pkg_path.join("extension.json").exists() {
                    return Some(pkg_path.join("extension.json"));
                }
            }
            continue;
        }
        if path.is_dir() && path.join("extension.json").exists() {
            return Some(path.join("extension.json"));
        }
    }
    None
}

fn install_from_path(src: &Path, location: PluginLocation, json_mode: bool) {
    match install_from_path_result(src, location) {
        Ok(outcome) => {
            if json_mode {
                println!(
                    "{}",
                    json!({
                        "success": true,
                        "data": {
                            "package": outcome.package,
                            "dir": outcome.dir.display().to_string(),
                            "manifest": outcome.manifest
                        }
                    })
                );
            } else {
                println!(
                    "{} Plugin installed from path: {}",
                    color::success_indicator(),
                    outcome.package
                );
                println!("  {}", outcome.dir.display());
                if !outcome.manifest {
                    eprintln!(
                        "{} No extension.json found after install. Plugin may be incomplete.",
                        color::warning_indicator()
                    );
                }
            }
        }
        Err(err) => {
            if json_mode {
                println!(r#"{{"success":false,"error":"{}"}}"#, err);
            } else {
                eprintln!("{}", color::red(&err));
            }
            exit(1);
        }
    }
}

#[derive(Debug)]
struct InstallOutcome {
    package: String,
    dir: PathBuf,
    manifest: bool,
}

fn install_from_path_result(
    src: &Path,
    location: PluginLocation,
) -> Result<InstallOutcome, String> {
    let root = resolve_plugins_root(location)?;

    let pkg_name = match read_package_name(src) {
        Some(name) => name,
        None => match src.file_name().and_then(|s| s.to_str()) {
            Some(name) => name.to_string(),
            None => return Err("Invalid plugin path".to_string()),
        },
    };

    if !is_plugin_package_name(&pkg_name) {
        return Err(
            "No plugin package found. Package must match agent-browser-plugin-* or @scope/agent-browser-plugin-*"
                .to_string(),
        );
    }

    let target_dir = root.join(sanitize_plugin_dir(&pkg_name));
    if target_dir.exists() {
        return Err("Plugin already exists".to_string());
    }

    copy_dir_recursive(src, &target_dir)?;
    let has_manifest = find_manifest(&target_dir).is_some();

    Ok(InstallOutcome {
        package: pkg_name,
        dir: target_dir,
        manifest: has_manifest,
    })
}

fn read_package_name(dir: &Path) -> Option<String> {
    let package_json = dir.join("package.json");
    if !package_json.exists() {
        return None;
    }
    let raw = fs::read_to_string(package_json).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    parsed.get("name").and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let entries = fs::read_dir(src).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        if file_name == "node_modules" {
            continue;
        }

        let target = dest.join(&file_name);
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else if file_type.is_file() {
            fs::copy(&path, &target).map_err(|e| e.to_string())?;
        } else {
            return Err(io::Error::new(io::ErrorKind::Other, "Unsupported file type")
                .to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let mut dir = env::temp_dir();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_micros();
        dir.push(format!("agent-browser-plugin-test-{}-{}", prefix, now));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn test_is_plugin_package_name() {
        assert!(is_plugin_package_name("agent-browser-plugin-example"));
        assert!(is_plugin_package_name("@scope/agent-browser-plugin-example"));
        assert!(!is_plugin_package_name("agent-browser-example"));
        assert!(!is_plugin_package_name("@scope/agent-browser-example"));
    }

    #[test]
    fn test_strip_package_version() {
        assert_eq!(
            strip_package_version("agent-browser-plugin-example@1.2.3"),
            Some("agent-browser-plugin-example")
        );
        assert_eq!(
            strip_package_version("@scope/agent-browser-plugin-example@1.2.3"),
            Some("@scope/agent-browser-plugin-example")
        );
    }

    #[test]
    fn test_extract_local_path() {
        let dir = temp_dir("local-path");
        let arg = dir.to_string_lossy().to_string();
        let result = extract_local_path(&[arg.clone()]);
        assert_eq!(result.unwrap(), PathBuf::from(arg));

        let result_none = extract_local_path(&["missing".to_string()]);
        assert!(result_none.is_none());
    }

    #[test]
    fn test_extract_plugin_package() {
        let cmd = vec!["pnpx".to_string(), "agent-browser-plugin-example@1.0.0".to_string()];
        assert_eq!(
            extract_plugin_package(&cmd),
            Some("agent-browser-plugin-example".to_string())
        );
        let cmd = vec![
            "npx".to_string(),
            "@scope/agent-browser-plugin-example@1.0.0".to_string(),
        ];
        assert_eq!(
            extract_plugin_package(&cmd),
            Some("@scope/agent-browser-plugin-example".to_string())
        );
    }

    #[test]
    fn test_read_package_name() {
        let dir = temp_dir("pkg-name");
        write_file(
            &dir.join("package.json"),
            r#"{ "name": "agent-browser-plugin-example" }"#,
        );
        assert_eq!(
            read_package_name(&dir),
            Some("agent-browser-plugin-example".to_string())
        );

        let empty = temp_dir("pkg-missing");
        assert_eq!(read_package_name(&empty), None);
    }

    #[test]
    fn test_copy_dir_recursive_skips_node_modules() {
        let src = temp_dir("copy-src");
        write_file(&src.join("file.txt"), "ok");
        write_file(&src.join("node_modules/skip.txt"), "skip");
        let dest = temp_dir("copy-dest");
        copy_dir_recursive(&src, &dest).unwrap();
        assert!(dest.join("file.txt").exists());
        assert!(!dest.join("node_modules").exists());
    }

    #[test]
    fn test_install_from_path_result() {
        let src = temp_dir("install-src");
        write_file(
            &src.join("package.json"),
            r#"{ "name": "agent-browser-plugin-example" }"#,
        );
        write_file(&src.join("extension.json"), r#"{}"#);
        write_file(&src.join("src/index.ts"), "export {};");

        let target_root = temp_dir("install-root");
        let outcome =
            install_from_path_result(&src, PluginLocation::Custom(target_root.clone())).unwrap();
        assert!(outcome.dir.exists());
        assert!(outcome.manifest);

        let duplicate = install_from_path_result(
            &src,
            PluginLocation::Custom(target_root.clone()),
        )
        .unwrap_err();
        assert_eq!(duplicate, "Plugin already exists");

        let bad = temp_dir("bad-plugin");
        write_file(&bad.join("package.json"), r#"{ "name": "bad-plugin" }"#);
        let err = install_from_path_result(&bad, PluginLocation::Custom(temp_dir("root")))
            .unwrap_err();
        assert!(
            err.contains("No plugin package found"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn test_parse_remove_args_auto() {
        let opts = parse_remove_args(&["example".to_string()]).unwrap();
        assert!(matches!(opts.location, PluginLocation::Auto));
        assert_eq!(opts.name, "example");
    }
}
