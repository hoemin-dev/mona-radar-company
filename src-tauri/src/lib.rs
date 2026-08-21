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
const MIGRATION_004: &str = include_str!("../migrations/004_collection_quality.sql");
const MIGRATION_005: &str = include_str!("../migrations/005_industry_master.sql");
const MIGRATION_006: &str = include_str!("../migrations/006_source_detail_model.sql");
const MIGRATION_007: &str = include_str!("../migrations/007_company_disclosure_state.sql");
#[cfg(windows)]
struct CollectorChild {
    child: Child,
    job: isize,
}

#[cfg(not(windows))]
struct CollectorChild { child: Child }

struct CollectorProcess(Mutex<Option<CollectorChild>>);
struct IndustryProcess(Mutex<Option<CollectorChild>>);

#[cfg(windows)]
impl CollectorChild {
    fn new(mut child: Child) -> Result<Self, String> {
        use std::{mem::size_of, os::windows::io::AsRawHandle, ptr::null};
        use windows_sys::Win32::{
            Foundation::{CloseHandle, HANDLE},
            System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
        };
        unsafe {
            let job=CreateJobObjectW(null(),null());
            if job.is_null(){let _=child.kill();return Err(format!("collector job creation failed: {}",std::io::Error::last_os_error()));}
            let mut info=JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(job,JobObjectExtendedLimitInformation,&info as *const _ as *const _,size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32)==0 {
                let error=std::io::Error::last_os_error();let _=child.kill();CloseHandle(job);return Err(format!("collector job configuration failed: {error}"));
            }
            if AssignProcessToJobObject(job,child.as_raw_handle() as HANDLE)==0 {
                let error=std::io::Error::last_os_error();let _=child.kill();CloseHandle(job);return Err(format!("collector job assignment failed: {error}"));
            }
            Ok(Self{child,job:job as isize})
        }
    }
    fn terminate(&mut self){
        use windows_sys::Win32::{Foundation::{CloseHandle,HANDLE},System::JobObjects::TerminateJobObject};
        unsafe { if self.job!=0 { TerminateJobObject(self.job as HANDLE,1); CloseHandle(self.job as HANDLE); self.job=0; } }
        let _=self.child.wait();
    }
}

#[cfg(not(windows))]
impl CollectorChild {
    fn new(child:Child)->Result<Self,String>{Ok(Self{child})}
    fn terminate(&mut self){let _=self.child.kill();let _=self.child.wait();}
}

impl Drop for CollectorChild { fn drop(&mut self){self.terminate();} }

fn terminate_collector(process:&CollectorProcess){
    if let Ok(mut guard)=process.0.lock(){if let Some(mut owned)=guard.take(){owned.terminate();}}
}
fn terminate_industry(process:&IndustryProcess){
    if let Ok(mut guard)=process.0.lock(){if let Some(mut owned)=guard.take(){owned.terminate();}}
}

#[cfg(all(test,windows))]
mod process_lifecycle_tests {
    use super::*;
    #[test]
    fn job_termination_cleans_node_process_tree(){
        use windows_sys::Win32::{Foundation::CloseHandle,System::Threading::{OpenProcess,WaitForSingleObject}};
        let node=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("runtime").join("node.exe");
        let script="setTimeout(()=>{const{spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);console.log(c.pid)},500);setInterval(()=>{},1000)";
        let mut child=Command::new(node).args(["-e",script]).stdout(Stdio::piped()).spawn().expect("spawn root node");
        let stdout=child.stdout.take().expect("root stdout");
        let mut owned=CollectorChild::new(child).expect("assign job");
        let mut line=String::new();
        BufReader::new(stdout).read_line(&mut line).expect("read descendant pid");
        let descendant_pid:u32=line.trim().parse().expect("descendant pid");
        let descendant=unsafe{OpenProcess(0x00100000,0,descendant_pid)};
        assert!(!descendant.is_null(),"descendant must be running before cleanup");
        owned.terminate();
        assert_eq!(unsafe{WaitForSingleObject(descendant,5_000)},0,"descendant must exit with the owned job");
        unsafe{CloseHandle(descendant)};
    }
}

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
    conn.execute_batch(MIGRATION_004).map_err(|e| e.to_string())?;
    conn.execute_batch(MIGRATION_005).map_err(|e| e.to_string())?;
    conn.execute_batch(MIGRATION_006).map_err(|e| e.to_string())?;
    conn.execute_batch(MIGRATION_007).map_err(|e| e.to_string())?;
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
    disclosure_status: Option<String>,
    disclosure_confirmed_at: Option<String>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IndustryCodeOption { industry_code:String, industry_name:String, classification_level:Option<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IndustryMasterStatus { count:i64, last_refreshed_at:Option<String>, status:String }

#[tauri::command]
fn search_industry_codes(app:AppHandle,query:Option<String>)->Result<Vec<IndustryCodeOption>,String>{
    let conn=connection(&app)?;let pattern=format!("%{}%",query.unwrap_or_default().trim());
    let mut stmt=conn.prepare("SELECT industry_code,industry_name,classification_level FROM industry_codes WHERE is_active=1 AND (?1='%%' OR industry_name LIKE ?1 OR industry_code LIKE ?1) ORDER BY industry_name COLLATE NOCASE LIMIT 30").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([pattern],|r|Ok(IndustryCodeOption{industry_code:r.get(0)?,industry_name:r.get(1)?,classification_level:r.get(2)?})).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(rows)
}

#[tauri::command]
fn industry_master_status(app:AppHandle)->Result<IndustryMasterStatus,String>{
    let conn=connection(&app)?;let count=conn.query_row("SELECT COUNT(*) FROM industry_codes WHERE is_active=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let last=conn.query_row("SELECT completed_at FROM industry_master_refreshes WHERE status='COMPLETED' ORDER BY completed_at DESC LIMIT 1",[],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    Ok(IndustryMasterStatus{count,last_refreshed_at:last,status:"IDLE".into()})
}

fn json_rows<F>(conn:&Connection,sql:&str,company_id:&str,mut mapper:F)->Result<Vec<serde_json::Value>,String>
where F:FnMut(&Row<'_>)->rusqlite::Result<serde_json::Value>{
    let mut stmt=conn.prepare(sql).map_err(|e|e.to_string())?;
    let rows=stmt.query_map(params![company_id],|row|mapper(row)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(rows)
}

#[tauri::command]
fn get_company_detail(app:AppHandle,company_id:String)->Result<serde_json::Value,String>{
    let conn=connection(&app)?;
    let company=conn.query_row("SELECT c.company_id,c.sminfo_kcd,c.business_number,c.company_name,c.representative_name,c.company_type,c.company_status,c.established_date,c.address,c.road_address,c.homepage_url,c.main_products,c.ksic_code,c.industry_name,c.last_collected_at,c.source_updated_at,d.disclosure_status,d.confirmed_at FROM companies c LEFT JOIN company_disclosure_state d ON d.company_id=c.company_id WHERE c.company_id=?",params![&company_id],|r|Ok(serde_json::json!({
      "companyId":r.get::<_,String>(0)?,"sminfoKcd":r.get::<_,String>(1)?,"businessNumber":r.get::<_,Option<String>>(2)?,"companyName":r.get::<_,String>(3)?,"representativeName":r.get::<_,Option<String>>(4)?,"companyType":r.get::<_,Option<String>>(5)?,"companyStatus":r.get::<_,Option<String>>(6)?,"establishedDate":r.get::<_,Option<String>>(7)?,"address":r.get::<_,Option<String>>(8)?,"roadAddress":r.get::<_,Option<String>>(9)?,"homepageUrl":r.get::<_,Option<String>>(10)?,"mainProducts":r.get::<_,Option<String>>(11)?,"ksicCode":r.get::<_,Option<String>>(12)?,"industryName":r.get::<_,Option<String>>(13)?,"lastCollectedAt":r.get::<_,String>(14)?,"sourceUpdatedAt":r.get::<_,Option<String>>(15)?,"disclosureStatus":r.get::<_,Option<String>>(16)?,"disclosureConfirmedAt":r.get::<_,Option<String>>(17)?
    }))).optional().map_err(|e|e.to_string())?.ok_or("기업을 찾을 수 없습니다.")?;
    let financials=json_rows(&conn,"SELECT fiscal_year,total_assets_krw_million,paid_in_capital_krw_million,total_equity_krw_million,revenue_krw_million,operating_income_krw_million,net_income_krw_million FROM company_financial_statements WHERE company_id=? ORDER BY fiscal_year DESC",&company_id,|r|Ok(serde_json::json!({"fiscalYear":r.get::<_,i64>(0)?,"totalAssets":r.get::<_,Option<i64>>(1)?,"paidInCapital":r.get::<_,Option<i64>>(2)?,"totalEquity":r.get::<_,Option<i64>>(3)?,"revenue":r.get::<_,Option<i64>>(4)?,"operatingIncome":r.get::<_,Option<i64>>(5)?,"netIncome":r.get::<_,Option<i64>>(6)?})))?;
    let sites=json_rows(&conn,"SELECT site_name,site_address FROM company_source_business_sites WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"siteName":r.get::<_,Option<String>>(0)?,"siteAddress":r.get::<_,Option<String>>(1)?})))?;
    let histories=json_rows(&conn,"SELECT source_number,event_date,description FROM company_source_histories WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"sourceNumber":r.get::<_,Option<String>>(0)?,"eventDate":r.get::<_,Option<String>>(1)?,"description":r.get::<_,Option<String>>(2)?})))?;
    let executives=json_rows(&conn,"SELECT source_number,position_title,masked_name FROM company_source_executives WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"sourceNumber":r.get::<_,Option<String>>(0)?,"positionTitle":r.get::<_,Option<String>>(1)?,"maskedName":r.get::<_,Option<String>>(2)?})))?;
    let certifications=json_rows(&conn,"SELECT certification_number,certification_name,certification_scope,validity_period,certification_authority FROM company_source_certifications WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"certificationNumber":r.get::<_,Option<String>>(0)?,"certificationName":r.get::<_,Option<String>>(1)?,"certificationScope":r.get::<_,Option<String>>(2)?,"validityPeriod":r.get::<_,Option<String>>(3)?,"certificationAuthority":r.get::<_,Option<String>>(4)?})))?;
    let designations=json_rows(&conn,"SELECT designation_number,designation_name,validity_period,operating_authority FROM company_source_designations WHERE company_id=? ORDER BY source_ordinal",&company_id,|r|Ok(serde_json::json!({"designationNumber":r.get::<_,Option<String>>(0)?,"designationName":r.get::<_,Option<String>>(1)?,"validityPeriod":r.get::<_,Option<String>>(2)?,"operatingAuthority":r.get::<_,Option<String>>(3)?})))?;
    Ok(serde_json::json!({"company":company,"financialStatements":financials,"businessSites":sites,"histories":histories,"executives":executives,"certifications":certifications,"designations":designations}))
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
        "SELECT c.company_id,c.sminfo_kcd,c.business_number,c.company_name,c.representative_name,c.company_type,c.company_status,c.established_date,c.address,c.road_address,c.homepage_url,c.main_products,c.ksic_code,c.industry_name,latest.fiscal_year,latest.total_assets_krw_million,latest.revenue_krw_million,latest.operating_income_krw_million,latest.net_income_krw_million,d.disclosure_status,d.confirmed_at
         FROM companies c
         LEFT JOIN company_financial_statements latest ON latest.company_id=c.company_id AND latest.fiscal_year=(SELECT MAX(fiscal_year) FROM company_financial_statements WHERE company_id=c.company_id)
         LEFT JOIN company_disclosure_state d ON d.company_id=c.company_id
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
                disclosure_status: r.get(19)?, disclosure_confirmed_at: r.get(20)?,
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
    if let Some(owned) = guard.as_mut() {
        if owned.child.try_wait().map_err(|e| e.to_string())?.is_none() { return Ok(()); }
    }
    guard.take();
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
    *guard = Some(CollectorChild::new(child)?);
    Ok(())
}

#[tauri::command]
fn refresh_industry_master(app:AppHandle,state:State<IndustryProcess>)->Result<(),String>{
    let credential=credentials::read()?.ok_or("SMINFO 계정 등록이 필요합니다.")?;
    let mut guard=state.0.lock().map_err(|_|"industry lock poisoned".to_string())?;
    if let Some(owned)=guard.as_mut(){if owned.child.try_wait().map_err(|e|e.to_string())?.is_none(){return Err("산업코드 갱신이 이미 실행 중입니다.".into())}}
    guard.take();
    let runtime=app.path().resource_dir().map_err(|e|e.to_string())?.join("runtime");
    let mut command=Command::new(runtime.join("node.exe"));
    command.arg("collector.mjs").arg("--industry-refresh").current_dir(&runtime).env("NODE_ENV","production").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] command.creation_flags(0x08000000);
    let mut child=command.spawn().map_err(|e|format!("industry refresh start failed: {e}"))?;
    if let Some(mut stdin)=child.stdin.take(){let payload=serde_json::json!({"username":credential.0,"password":credential.1}).to_string();stdin.write_all(payload.as_bytes()).map_err(|e|e.to_string())?;}
    if let Some(stdout)=child.stdout.take(){let handle=app.clone();std::thread::spawn(move||for line in BufReader::new(stdout).lines().map_while(Result::ok){if let Ok(value)=serde_json::from_str::<serde_json::Value>(&line){let _=handle.emit("industry-event",value);}});}
    if let Some(stderr)=child.stderr.take(){let handle=app.clone();std::thread::spawn(move||for line in BufReader::new(stderr).lines().map_while(Result::ok){if !line.contains("ExperimentalWarning"){let _=handle.emit("industry-event",serde_json::json!({"type":"industry_refresh_status","status":"FAILED","message":line}));}});}
    *guard=Some(CollectorChild::new(child)?);Ok(())
}

fn send_control(state: &CollectorProcess, command: &str) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "collector lock poisoned".to_string())?;
    let owned = guard.as_mut().ok_or("collector is not running")?;
    let input = owned.child.stdin.as_mut().ok_or("collector input unavailable")?;
    writeln!(input, "{command}").map_err(|e| e.to_string())?;
    input.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn credential_status() -> Result<credentials::CredentialStatus, String> {
    match credentials::read(){
      Ok(value)=>{let saved=value.is_some();Ok(credentials::CredentialStatus { saved, username: value.map(|x| x.0),credential_status:if saved{"SAVED".into()}else{"MISSING".into()} })},
      Err(error)=>Ok(credentials::CredentialStatus{saved:false,username:None,credential_status:format!("READ_ERROR: {error}")})
    }
}

#[tauri::command]
fn save_sminfo_credential(username: String, password: String) -> Result<credentials::CredentialStatus, String> {
    credentials::save(&username, &password)?;
    let verified=credentials::read()?.is_some_and(|(saved_user,saved_password)|saved_user==username.trim()&&saved_password==password);
    if !verified { let _=credentials::delete(); return Err("Windows Credential Manager 저장 왕복 검증에 실패했습니다.".into()); }
    Ok(credentials::CredentialStatus { saved: true, username: Some(username.trim().to_string()),credential_status:"SAVED".into() })
}

#[tauri::command]
fn delete_sminfo_credential() -> Result<credentials::CredentialStatus, String> {
    credentials::delete()?;
    Ok(credentials::CredentialStatus { saved: false, username: None,credential_status:"MISSING".into() })
}

#[tauri::command]
fn start_collection(state: State<CollectorProcess>, target: Option<String>, industry_code:Option<String>) -> Result<(), String> {
    let credential = credentials::read()?;
    let command = serde_json::json!({
        "command": "start",
        "target": target.unwrap_or_else(|| "액체 펌프 제조업".to_string()),
        "industryCode": industry_code,
        "credential": credential.map(|(username, password)| serde_json::json!({"username":username,"password":password}))
    });
    send_control(state.inner(), &command.to_string())
}
#[tauri::command]
fn login_sminfo(state: State<CollectorProcess>) -> Result<(), String> {
    let credential = credentials::read()?.ok_or("SMINFO 계정 등록이 필요합니다.")?;
    send_control(state.inner(), &serde_json::json!({"command":"login","credential":{"username":credential.0,"password":credential.1}}).to_string())
}
#[tauri::command] fn pause_collection(state: State<CollectorProcess>) -> Result<(), String> { send_control(state.inner(), "pause") }
#[tauri::command] fn resume_collection(state: State<CollectorProcess>) -> Result<(), String> {
    let credential=credentials::read()?;
    send_control(state.inner(),&serde_json::json!({"command":"resume","credential":credential.map(|(username,password)|serde_json::json!({"username":username,"password":password}))}).to_string())
}
#[tauri::command]
fn stop_collection(state: State<CollectorProcess>) -> Result<(), String> {
    send_control(state.inner(), "shutdown")?;
    for _ in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let exited={
            let mut guard=state.0.lock().map_err(|_|"collector lock poisoned".to_string())?;
            match guard.as_mut(){Some(owned)=>owned.child.try_wait().map_err(|e|e.to_string())?.is_some(),None=>true}
        };
        if exited { break; }
    }
    terminate_collector(state.inner());
    Ok(())
}
#[tauri::command] fn run_navigation_test(state: State<CollectorProcess>) -> Result<(), String> { send_control(state.inner(), "nav_test") }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app=tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(CollectorProcess(Mutex::new(None)))
        .manage(IndustryProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![initialize_database, search_companies, get_company_detail, list_collector_targets, search_industry_codes, industry_master_status, refresh_industry_master, credential_status, save_sminfo_credential, delete_sminfo_credential, open_collector, login_sminfo, start_collection, pause_collection, resume_collection, stop_collection, run_navigation_test])
        .setup(|app| { connection(&app.handle()).map_err(std::io::Error::other)?; Ok(()) })
        .build(tauri::generate_context!())
        .expect("error while building MONA RADAR");
    app.run(|handle,event|{
        if matches!(event,tauri::RunEvent::ExitRequested { .. }|tauri::RunEvent::Exit){
            terminate_collector(handle.state::<CollectorProcess>().inner());
            terminate_industry(handle.state::<IndustryProcess>().inner());
        }
    });
}
