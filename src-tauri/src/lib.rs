use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
mod credentials;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const MIGRATION_001: &str = include_str!("../migrations/001_initial.sql");
const MIGRATION_002: &str = include_str!("../migrations/002_collector_automation.sql");
const MIGRATION_003: &str = include_str!("../migrations/003_company_detail_sections.sql");
struct CollectorProcess(Mutex<Option<Child>>);

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("data");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("mona-radar-company.sqlite3"))
}

fn connection(app: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", true).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    conn.execute_batch(MIGRATION_001).map_err(|e| e.to_string())?;
    conn.execute_batch(MIGRATION_002).map_err(|e| e.to_string())?;
    conn.execute_batch(MIGRATION_003).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanyRow {
    company_id: String,
    sminfo_kcd: String,
    business_number: Option<String>,
    company_name: String,
    representative_name: Option<String>,
    company_type: Option<String>,
    company_status: Option<String>,
    established_date: Option<String>,
    address: Option<String>,
    road_address: Option<String>,
    homepage_url: Option<String>,
    main_products: Option<String>,
    ksic_code: Option<String>,
    industry_name: Option<String>,
    fiscal_year: Option<i64>,
    total_assets_krw_million: Option<i64>,
    revenue_krw_million: Option<i64>,
    operating_income_krw_million: Option<i64>,
    net_income_krw_million: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    rows: Vec<CompanyRow>,
    total: i64,
    page: i64,
    total_pages: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetOption { target_id: String, name: String }

fn json_rows<F>(conn:&Connection,sql:&str,company_id:&str,mut mapper:F)->Result<Vec<serde_json::Value>,String>
where F:FnMut(&Row<'_>)->rusqlite::Result<serde_json::Value>{
    let mut stmt=conn.prepare(sql).map_err(|e|e.to_string())?;
    let rows=stmt.query_map(params![company_id],|row|mapper(row)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(rows)
}

#[tauri::command]
fn get_company_detail(app:AppHandle,company_id:String)->Result<serde_json::Value,String>{
    let conn=connection(&app)?;
    let company=conn.query_row("SELECT company_id,sminfo_kcd,business_number,company_name,representative_name,company_type,company_status,established_date,address,road_address,homepage_url,main_products,ksic_code,industry_name,last_collected_at FROM companies WHERE company_id=?",params![&company_id],|r|Ok(serde_json::json!({
      "companyId":r.get::<_,String>(0)?,"sminfoKcd":r.get::<_,String>(1)?,"businessNumber":r.get::<_,Option<String>>(2)?,"companyName":r.get::<_,String>(3)?,"representativeName":r.get::<_,Option<String>>(4)?,"companyType":r.get::<_,Option<String>>(5)?,"companyStatus":r.get::<_,Option<String>>(6)?,"establishedDate":r.get::<_,Option<String>>(7)?,"address":r.get::<_,Option<String>>(8)?,"roadAddress":r.get::<_,Option<String>>(9)?,"homepageUrl":r.get::<_,Option<String>>(10)?,"mainProducts":r.get::<_,Option<String>>(11)?,"ksicCode":r.get::<_,Option<String>>(12)?,"industryName":r.get::<_,Option<String>>(13)?,"lastCollectedAt":r.get::<_,String>(14)?
    }))).optional().map_err(|e|e.to_string())?.ok_or("기업을 찾을 수 없습니다.")?;
    let financials=json_rows(&conn,"SELECT fiscal_year,total_assets_krw_million,paid_in_capital_krw_million,total_equity_krw_million,revenue_krw_million,operating_income_krw_million,net_income_krw_million FROM company_financial_statements WHERE company_id=? ORDER BY fiscal_year DESC",&company_id,|r|Ok(serde_json::json!({"fiscalYear":r.get::<_,i64>(0)?,"totalAssets":r.get::<_,Option<i64>>(1)?,"paidInCapital":r.get::<_,Option<i64>>(2)?,"totalEquity":r.get::<_,Option<i64>>(3)?,"revenue":r.get::<_,Option<i64>>(4)?,"operatingIncome":r.get::<_,Option<i64>>(5)?,"netIncome":r.get::<_,Option<i64>>(6)?})))?;
    let sites=json_rows(&conn,"SELECT site_name,site_type,business_number,address FROM company_business_sites WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"siteName":r.get::<_,Option<String>>(0)?,"siteType":r.get::<_,Option<String>>(1)?,"businessNumber":r.get::<_,Option<String>>(2)?,"address":r.get::<_,Option<String>>(3)?})))?;
    let histories=json_rows(&conn,"SELECT event_date,description FROM company_histories WHERE company_id=? ORDER BY event_date DESC,source_ordinal",&company_id,|r|Ok(serde_json::json!({"eventDate":r.get::<_,Option<String>>(0)?,"description":r.get::<_,Option<String>>(1)?})))?;
    let executives=json_rows(&conn,"SELECT position_title,masked_name FROM company_executives WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"positionTitle":r.get::<_,Option<String>>(0)?,"maskedName":r.get::<_,Option<String>>(1)?})))?;
    let certifications=json_rows(&conn,"SELECT certification_name,certification_number,issuer,acquired_date,valid_until FROM company_certifications WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"certificationName":r.get::<_,Option<String>>(0)?,"certificationNumber":r.get::<_,Option<String>>(1)?,"issuer":r.get::<_,Option<String>>(2)?,"acquiredDate":r.get::<_,Option<String>>(3)?,"validUntil":r.get::<_,Option<String>>(4)?})))?;
    let designations=json_rows(&conn,"SELECT designation_name,designation_number,authority,designated_date,valid_until FROM company_designations WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"designationName":r.get::<_,Option<String>>(0)?,"designationNumber":r.get::<_,Option<String>>(1)?,"authority":r.get::<_,Option<String>>(2)?,"designatedDate":r.get::<_,Option<String>>(3)?,"validUntil":r.get::<_,Option<String>>(4)?})))?;
    let factories=json_rows(&conn,"SELECT factory_name,location_address FROM company_factories WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"factoryName":r.get::<_,Option<String>>(0)?,"locationAddress":r.get::<_,Option<String>>(1)?})))?;
    let patents=json_rows(&conn,"SELECT patent_date,description FROM company_patents WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"patentDate":r.get::<_,Option<String>>(0)?,"description":r.get::<_,Option<String>>(1)?})))?;
    Ok(serde_json::json!({"company":company,"financialStatements":financials,"businessSites":sites,"histories":histories,"executives":executives,"certifications":certifications,"designations":designations,"factories":factories,"patents":patents}))
}

#[tauri::command]
fn list_collector_targets(app: AppHandle) -> Result<Vec<TargetOption>, String> {
    let conn = connection(&app)?;
    let mut stmt = conn.prepare("SELECT target_id,COALESCE(industry_name,search_keyword) FROM collector_targets ORDER BY COALESCE(industry_name,search_keyword) COLLATE NOCASE").map_err(|e|e.to_string())?;
    let rows = stmt.query_map([],|r|Ok(TargetOption{target_id:r.get(0)?,name:r.get(1)?})).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(rows)
}

#[tauri::command]
fn initialize_database(app: AppHandle) -> Result<String, String> {
    let _ = connection(&app)?;
    Ok(db_path(&app)?.display().to_string())
}

#[tauri::command]
fn search_companies(app: AppHandle, query: Option<String>, page: Option<i64>, target_id: Option<String>) -> Result<SearchResponse, String> {
    let conn = connection(&app)?;
    let query = query.unwrap_or_default().trim().to_string();
    let pattern = format!("%{}%", query);
    let page = page.unwrap_or(1).max(1);
    let page_size = 10_i64;
    let target_id = target_id.unwrap_or_default();
    let where_sql = "(?1 = '%%' OR c.company_name LIKE ?1 OR IFNULL(c.business_number,'') LIKE ?1 OR IFNULL(c.main_products,'') LIKE ?1 OR IFNULL(c.address,'') LIKE ?1 OR IFNULL(c.road_address,'') LIKE ?1 OR IFNULL(c.industry_name,'') LIKE ?1 OR IFNULL(c.representative_name,'') LIKE ?1) AND (?2='' OR EXISTS(SELECT 1 FROM company_industries ci WHERE ci.company_id=c.company_id AND ci.target_id=?2))";
    let total: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM companies c WHERE {where_sql}"), params![&pattern,&target_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let total_pages = ((total + page_size - 1) / page_size).max(1);
    let effective_page = page.min(total_pages);
    let effective_offset = (effective_page - 1) * page_size;
    let normalized_name = "trim(replace(replace(replace(c.company_name,'(주)',''),'㈜',''),'주식회사',''))";
    let sql = format!(
        "SELECT c.company_id,c.sminfo_kcd,c.business_number,c.company_name,c.representative_name,c.company_type,c.company_status,c.established_date,c.address,c.road_address,c.homepage_url,c.main_products,c.ksic_code,c.industry_name,latest.fiscal_year,latest.total_assets_krw_million,latest.revenue_krw_million,latest.operating_income_krw_million,latest.net_income_krw_million
         FROM companies c
         LEFT JOIN company_financial_statements latest ON latest.company_id=c.company_id AND latest.fiscal_year=(SELECT MAX(fiscal_year) FROM company_financial_statements WHERE company_id=c.company_id)
         WHERE {where_sql}
         ORDER BY CASE WHEN substr({normalized_name},1,1) BETWEEN '가' AND '힣' THEN 0 WHEN lower(substr({normalized_name},1,1)) BETWEEN 'a' AND 'z' THEN 1 ELSE 2 END, {normalized_name} COLLATE NOCASE, c.company_name COLLATE NOCASE
         LIMIT ?3 OFFSET ?4"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![&pattern, &target_id, page_size, effective_offset], |r| {
            Ok(CompanyRow {
                company_id: r.get(0)?, sminfo_kcd: r.get(1)?, business_number: r.get(2)?, company_name: r.get(3)?,
                representative_name: r.get(4)?, company_type: r.get(5)?, company_status: r.get(6)?, established_date: r.get(7)?,
                address: r.get(8)?, road_address: r.get(9)?, homepage_url: r.get(10)?, main_products: r.get(11)?,
                ksic_code: r.get(12)?, industry_name: r.get(13)?, fiscal_year: r.get(14)?, total_assets_krw_million: r.get(15)?,
                revenue_krw_million: r.get(16)?, operating_income_krw_million: r.get(17)?, net_income_krw_million: r.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(SearchResponse { rows, total, page: effective_page, total_pages })
}

#[tauri::command]
fn open_collector(app: AppHandle, state: State<CollectorProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "collector lock poisoned".to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() { return Ok(()); }
    }
    let runtime = app.path().resource_dir().map_err(|e| e.to_string())?.join("runtime");
    let mut command = Command::new(runtime.join("node.exe"));
    command.arg("collector.mjs").current_dir(&runtime).env("NODE_ENV", "production")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| format!("collector start failed: {e}"))?;
    if let Some(stdout) = child.stdout.take() {
        let handle = app.clone();
        std::thread::spawn(move || for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) { let _ = handle.emit("collector-event", value); }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let handle = app.clone();
        std::thread::spawn(move || for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !line.contains("ExperimentalWarning") { let _ = handle.emit("collector-event", serde_json::json!({"type":"error","code":"COLLECTOR_RUNTIME_ERROR","message":line})); }
        });
    }
    *guard = Some(child);
    Ok(())
}

fn send_control(state: State<CollectorProcess>, command: &str) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "collector lock poisoned".to_string())?;
    let child = guard.as_mut().ok_or("collector is not running")?;
    let input = child.stdin.as_mut().ok_or("collector input unavailable")?;
    writeln!(input, "{command}").map_err(|e| e.to_string())?;
    input.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn credential_status() -> Result<credentials::CredentialStatus, String> {
    let value = credentials::read()?;
    Ok(credentials::CredentialStatus { saved: value.is_some(), username: value.map(|x| x.0) })
}

#[tauri::command]
fn save_sminfo_credential(username: String, password: String) -> Result<credentials::CredentialStatus, String> {
    credentials::save(&username, &password)?;
    let verified=credentials::read()?.is_some_and(|(saved_user,saved_password)|saved_user==username.trim()&&saved_password==password);
    if !verified { let _=credentials::delete(); return Err("Windows Credential Manager 저장 왕복 검증에 실패했습니다.".into()); }
    Ok(credentials::CredentialStatus { saved: true, username: Some(username.trim().to_string()) })
}

#[tauri::command]
fn delete_sminfo_credential() -> Result<credentials::CredentialStatus, String> {
    credentials::delete()?;
    Ok(credentials::CredentialStatus { saved: false, username: None })
}

#[tauri::command]
fn start_collection(state: State<CollectorProcess>, target: Option<String>) -> Result<(), String> {
    let credential = credentials::read()?;
    let command = serde_json::json!({
        "command": "start",
        "target": target.unwrap_or_else(|| "액체 펌프 제조업".to_string()),
        "credential": credential.map(|(username, password)| serde_json::json!({"username":username,"password":password}))
    });
    send_control(state, &command.to_string())
}
#[tauri::command]
fn login_sminfo(state: State<CollectorProcess>) -> Result<(), String> {
    let credential = credentials::read()?.ok_or("SMINFO 계정 등록이 필요합니다.")?;
    send_control(state, &serde_json::json!({"command":"login","credential":{"username":credential.0,"password":credential.1}}).to_string())
}
#[tauri::command] fn pause_collection(state: State<CollectorProcess>) -> Result<(), String> { send_control(state, "pause") }
#[tauri::command] fn resume_collection(state: State<CollectorProcess>) -> Result<(), String> { send_control(state, "resume") }
#[tauri::command] fn stop_collection(state: State<CollectorProcess>) -> Result<(), String> { send_control(state, "stop") }
#[tauri::command] fn run_navigation_test(state: State<CollectorProcess>) -> Result<(), String> { send_control(state, "nav_test") }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CollectorProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![initialize_database, search_companies, get_company_detail, list_collector_targets, credential_status, save_sminfo_credential, delete_sminfo_credential, open_collector, login_sminfo, start_collection, pause_collection, resume_collection, stop_collection, run_navigation_test])
        .setup(|app| { connection(&app.handle()).map_err(std::io::Error::other)?; Ok(()) })
        .run(tauri::generate_context!())
        .expect("error while running MONA RADAR");
}
