import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleAlert, Clipboard, FileText, Files, Menu, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';

type Line = { description: string; tariffNo: string; quantity: number; unit: string; value: number; countryOrigin: string; grossWeight?: number };
type Draft = { invoiceNo: string; importerTaxId: string; consigneeName: string; entryDate: string; entryType: string; entryPort: string; processingPort: string; transportMode: string; arrivalDate: string; vessel: string; voyage: string; carrierCode: string; houseBill: string; masterBill: string; packages: number; packageUnit: string; grossWeight: number; customerReference: string; lines: Line[] };
type Review = { level: 'blocker' | 'review'; title: string; detail: string };
type Doc = { filename: string; bytes: number; text: string; parseError?: string };
type Tab = 'shipment' | 'documents' | 'xml';

const emptyDraft: Draft = { invoiceNo: '', importerTaxId: '', consigneeName: '', entryDate: new Date().toISOString().slice(0,10), entryType: '01', entryPort: '0000', processingPort: '0000', transportMode: '11', arrivalDate: '', vessel: '', voyage: '', carrierCode: '', houseBill: '', masterBill: '', packages: 0, packageUnit: 'CTNS', grossWeight: 0, customerReference: '', lines: [] };
const emptyReviews: Review[] = [
  {level:'blocker',title:'Importer profile and broker setup',detail:'Confirm importer tax ID, filer profile, processing port, entry type, bond and payment details.'},
  {level:'blocker',title:'Classify every line to current HTSUS',detail:'The uploaded documents do not provide U.S. 10-digit tariff numbers. Confirm classification, units and duty treatment.'},
  {level:'blocker',title:'Confirm customs value',detail:'Reconcile invoice totals, assists, samples, freight, insurance and any related-party terms with the broker.'},
  {level:'review',title:'Verify parties, origin, quantity and transport details',detail:'Review every extracted field against the commercial invoice, packing list and bill of lading.'},
];
const fmt = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
const fileSize = (n: number) => n > 1024*1024 ? `${(n/1024/1024).toFixed(1)} MB` : `${Math.max(1,Math.round(n/1024))} KB`;

function App() {
  const [draft,setDraft]=useState<Draft>(emptyDraft);
  const [reviews,setReviews]=useState<Review[]>([]);
  const [docs,setDocs]=useState<Doc[]>([]);
  const [tab,setTab]=useState<Tab>('shipment');
  const [xml,setXml]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState('');
  const [showRaw,setShowRaw]=useState<string|null>(null);
  const inputRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{ void loadSample(); },[]);
  useEffect(()=>{ if(tab==='xml') void refreshXml(); },[tab,draft]);
  useEffect(()=>{ if(!toast)return; const timer=window.setTimeout(()=>setToast(''),2600);return()=>clearTimeout(timer); },[toast]);

  async function loadSample(){
    setLoading(true);
    try { const r=await fetch('/api/sample'); const d=await r.json(); setDraft(d.draft);setReviews(d.reviewItems);setDocs([]);setXml(''); }
    catch { setToast('Could not reach the local API. Start the app with npm run dev.'); }
    finally { setLoading(false); }
  }
  function newEntry(){setDraft({...emptyDraft,lines:[]});setDocs([]);setReviews(emptyReviews);setXml('');setTab('shipment');setToast('New blank entry started');}
  async function refreshXml(){
    try { const r=await fetch('/api/xml',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)}); const d=await r.json(); if(r.ok)setXml(d.xml);else setToast(d.error||'XML generation failed.'); }
    catch { setToast('Could not generate XML. Check that the API is running.'); }
  }
  async function addFiles(files:FileList|File[]|null){
    if(!files?.length)return;
    setBusy(true);
    const form=new FormData(); Array.from(files).forEach(f=>form.append('documents',f));
    try {
      const r=await fetch('/api/documents',{method:'POST',body:form}); const d=await r.json();
      if(!r.ok)throw new Error(d.error||'Upload failed.');
      const next:Doc[]=d.files; setDocs(prev=>[...prev,...next]);
      setDraft(v=>({...v,
        ...(d.suggestions?.invoiceNo?{invoiceNo:d.suggestions.invoiceNo}:{}),
        ...(d.suggestions?.houseBill?{houseBill:d.suggestions.houseBill}:{}),
        ...(d.suggestions?.customerReference?{customerReference:d.suggestions.customerReference}:{}),
        ...(d.suggestions?.consigneeName?{consigneeName:d.suggestions.consigneeName}:{}),
        ...(d.suggestions?.packages?{packages:d.suggestions.packages}:{}),
        ...(d.suggestions?.grossWeight?{grossWeight:d.suggestions.grossWeight}:{}),
        ...(d.suggestions?.vessel?{vessel:d.suggestions.vessel}:{}),
      }));
      setTab('documents');setToast(`${next.length} document${next.length===1?'':'s'} processed`);
    } catch(e){setToast(e instanceof Error?e.message:'Upload failed.');}
    finally {setBusy(false); if(inputRef.current)inputRef.current.value='';}
  }
  function set<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(v=>({...v,[key]:value}));}
  function setLine(i:number,key:keyof Line,value:string|number){setDraft(v=>({...v,lines:v.lines.map((line,j)=>j===i?{...line,[key]:value}:line)}));}
  function addLine(){setDraft(v=>({...v,lines:[...v.lines,{description:'',tariffNo:'',quantity:0,unit:'PCS',value:0,countryOrigin:'',grossWeight:0}]}));}
  function removeLine(i:number){setDraft(v=>({...v,lines:v.lines.filter((_,j)=>j!==i)}));}
  async function copyXml(){await navigator.clipboard.writeText(xml);setToast('XML copied to clipboard');}
  function downloadXml(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([xml],{type:'application/xml'}));a.download=`${draft.invoiceNo||'entry'}-netchb.xml`;a.click();URL.revokeObjectURL(a.href);setToast('XML file downloaded');}
  const total=useMemo(()=>draft.lines.reduce((s,l)=>s+(Number(l.value)||0),0),[draft.lines]);
  const blocking=reviews.filter(x=>x.level==='blocker').length;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><span></span><span></span><span></span></div><span>sefer</span><span className="brand-tag">BROKER WORKSPACE</span></div>
      <div className="workspace-switch"><div className="workspace-icon">N</div><div><b>Northbound team</b><small>Workspace</small></div><ChevronDown size={15}/></div>
      <div className="nav-label">WORKSPACE</div>
      <button className="nav-item active"><Files size={17}/> Shipment entries <span className="nav-count">1</span></button>
      <button className="nav-item"><FileText size={17}/> Document library</button>
      <button className="nav-item"><ShieldCheck size={17}/> Broker settings</button>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Sparkles size={16}/></div><b>Ready for a second set of eyes?</b><p>Every field stays reviewable before your team files.</p><button onClick={()=>setToast('Review the flagged fields and confirm each value before filing.')}>How review works <ArrowRight size={14}/></button></div><div className="user-row"><div className="avatar">AM</div><div><b>Alex Morgan</b><small>Entry specialist</small></div><Menu size={17}/></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><span>Shipments</span><span className="crumb-sep">/</span><b>{draft.invoiceNo||'New shipment'}</b></div><div className="top-actions"><span className="saved"><span className="saved-dot"/> Local draft</span><button className="quiet-btn" onClick={newEntry}><Plus size={14}/> New entry</button><button className="quiet-btn" onClick={()=>void loadSample()}><RefreshCw size={14}/> Load demo</button><button className="top-avatar">AM</button></div></header>
      <div className="content">
        <div className="heading-row"><div><div className="eyebrow"><span className="eyebrow-dot"/> ENTRY PREPARATION <span className="slash">/</span> 01</div><h1>Turn shipment docs into an entry.</h1><p className="subhead">Upload the paperwork. Review extracted details. Export a NetCHB XML draft.</p></div><button className="primary-btn" onClick={downloadXml} disabled={!xml}><ArrowDownToLine size={16}/> Download XML</button></div>
        <div className="status-strip"><div className="status-item"><span className="status-icon mint"><Files size={17}/></span><div><b>{docs.length||3} documents</b><small>{docs.length?`${docs.length} uploaded`:'Invoice · Packing list · Bill of lading'}</small></div></div><div className="status-divider"/><div className="status-item"><span className="status-icon amber"><CircleAlert size={17}/></span><div><b>{blocking} details to complete</b><small>Broker review needed before filing</small></div></div><div className="status-divider"/><div className="status-item"><span className="status-icon violet"><FileText size={17}/></span><div><b>{draft.lines.length} invoice lines</b><small>{fmt(total)} extracted goods value</small></div></div><div className="status-right"><span className="draft-pill"><span/> DRAFT</span></div></div>
        <div className="tabs"><button className={tab==='shipment'?'selected':''} onClick={()=>setTab('shipment')}>Shipment details <span className="tab-number">01</span></button><button className={tab==='documents'?'selected':''} onClick={()=>setTab('documents')}>Documents <span className="tab-number">{docs.length||3}</span></button><button className={tab==='xml'?'selected':''} onClick={()=>setTab('xml')}>NetCHB XML <span className="xml-status"><span/> Ready to review</span></button></div>

        {tab==='shipment'&&<div className="workspace-grid">
          <section className="left-column">
            <div className="card section-card"><div className="card-header"><div><div className="section-kicker">01 <span>SHIPMENT</span></div><h2>Entry overview</h2><p>Shipment and party information extracted from the source documents.</p></div><span className="source-tag"><Sparkles size={12}/> Document-based</span></div>
              <div className="field-grid three">
                <Field label="Invoice number" value={draft.invoiceNo} onChange={v=>set('invoiceNo',v)} source="Invoice"/>
                <Field label="Entry type" value={draft.entryType} onChange={v=>set('entryType',v)} hint="01 = consumption"/>
                <Field label="Entry date" value={draft.entryDate} onChange={v=>set('entryDate',v)} type="date" flag="Confirm"/>
                <Field label="Importer tax ID" value={draft.importerTaxId} onChange={v=>set('importerTaxId',v)} placeholder="Required · not on documents" flag="Missing"/>
                <Field label="Ultimate consignee" value={draft.consigneeName} onChange={v=>set('consigneeName',v)} source="Invoice + B/L"/>
                <Field label="Customer reference" value={draft.customerReference} onChange={v=>set('customerReference',v)} source="Buyer PO"/>
                <Field label="Entry port" value={draft.entryPort} onChange={v=>set('entryPort',v)} placeholder="4-digit CBP port code" flag={draft.entryPort==='3002'?'Tacoma · CBP':'Confirm'}/>
                <Field label="Processing port" value={draft.processingPort} onChange={v=>set('processingPort',v)} placeholder="4-digit CBP port code" flag="Confirm"/>
                <Field label="Mode of transport" value={draft.transportMode} onChange={v=>set('transportMode',v)} hint="11 = containerized vessel"/>
                <Field label="Actual arrival date" value={draft.arrivalDate} onChange={v=>set('arrivalDate',v)} type="date" source="B/L ETA"/>
              </div>
            </div>
            <div className="card section-card"><div className="card-header"><div><div className="section-kicker">02 <span>MANIFEST</span></div><h2>Routing &amp; cargo</h2><p>Arrival, carrier and bill of lading details.</p></div><span className="complete-tag"><Check size={12}/> From B/L</span></div>
              <div className="field-grid three">
                <Field label="Vessel" value={draft.vessel} onChange={v=>set('vessel',v)} source="B/L"/><Field label="Voyage" value={draft.voyage} onChange={v=>set('voyage',v)} source="B/L"/><Field label="Carrier SCAC" value={draft.carrierCode} onChange={v=>set('carrierCode',v)} source="B/L"/>
                <Field label="House bill" value={draft.houseBill} onChange={v=>set('houseBill',v)} source="B/L"/><Field label="Master bill" value={draft.masterBill} onChange={v=>set('masterBill',v)} source="B/L"/><Field label="Packages" value={draft.packages} onChange={v=>set('packages',Number(v))} suffix="CTNS" source="B/L"/>
                <Field label="Gross weight" value={draft.grossWeight} onChange={v=>set('grossWeight',Number(v))} suffix="KG" flag="Weight differs across docs"/><Field label="Importer of record" value="NORTHBOUND OUTFITTERS, INC." onChange={()=>{}} readOnly/><Field label="Port of unlading" value="Tacoma, WA" onChange={()=>{}} readOnly/>
              </div>
            </div>
            <div className="card lines-card"><div className="card-header lines-head"><div><div className="section-kicker">03 <span>INVOICE</span></div><h2>Invoice line items</h2><p>Descriptions and declared amounts from the commercial invoice.</p></div><button className="outline-btn" onClick={addLine}><Plus size={14}/> Add line</button></div>
              <div className="table-wrap"><table><thead><tr><th>DESCRIPTION</th><th>INVOICE HS · HTSUS REVIEW</th><th>QTY</th><th>ORIGIN</th><th className="align-right">VALUE</th><th></th></tr></thead><tbody>{draft.lines.map((line,i)=><tr key={i}><td><div className="desc-cell"><span className="row-num">{String(i+1).padStart(2,'0')}</span><input value={line.description} onChange={e=>setLine(i,'description',e.target.value)} aria-label={`Line ${i+1} description`}/></div></td><td><input className="mono-input tariff-input" value={line.tariffNo} onChange={e=>setLine(i,'tariffNo',e.target.value)} aria-label={`Line ${i+1} tariff`}/></td><td><input className="quantity-input" type="number" value={line.quantity} onChange={e=>setLine(i,'quantity',Number(e.target.value))} aria-label={`Line ${i+1} quantity`}/><small>{line.unit}</small></td><td><input className="origin-input" value={line.countryOrigin} onChange={e=>setLine(i,'countryOrigin',e.target.value.toUpperCase())} aria-label={`Line ${i+1} origin`}/></td><td><div className="value-input"><span>$</span><input type="number" value={line.value} onChange={e=>setLine(i,'value',Number(e.target.value))} aria-label={`Line ${i+1} value`}/></div></td><td><button className="delete-line" onClick={()=>removeLine(i)} aria-label="Remove line"><X size={14}/></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>{draft.lines.length} lines · USD</span><div><span>GOODS VALUE</span><b>{fmt(total)}</b></div></div>
              <div className="assist-note"><span className="assist-icon">!</span><div><b>Separate value adjustment identified</b><p>Buyer-supplied fabric valued at $4,180 is disclosed outside this invoice total. Confirm dutiability and allocate before filing.</p></div><button onClick={()=>setTab('xml')}>Review <ArrowRight size={13}/></button></div>
            </div>
          </section>
          <aside className="right-column"><div className="card upload-card"><div className="upload-title"><div><div className="section-kicker">SOURCE FILES</div><h2>Your documents</h2></div><button className="icon-btn" onClick={()=>inputRef.current?.click()} aria-label="Upload documents"><Plus size={16}/></button></div><div className="doc-list">{(docs.length?docs:[{filename:'KBAS-NB-26-0912_Commercial_Invoice.pdf',bytes:51_000,text:''},{filename:'SPG-PL-2609-117_Packing_List.pdf',bytes:203_000,text:''},{filename:'BMLVHCM26090418_House_BL.pdf',bytes:203_000,text:''}]).map((doc,i)=><div className="doc-row" key={`${doc.filename}-${i}`}><div className={`file-icon f${i%3}`}><FileText size={15}/></div><div className="doc-name"><b>{doc.filename}</b><small>{fileSize(doc.bytes)} <span>·</span> {doc.parseError?'Needs OCR':docs.length?'Text extracted':'Reviewed'}</small></div><span className={`doc-check ${doc.parseError?'doc-warn':''}`}>{doc.parseError?<CircleAlert size={15}/>:<Check size={15}/>}</span></div>)}</div><button className="dropzone" onClick={()=>inputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void addFiles(e.dataTransfer.files);}}><span className="upload-symbol"><Upload size={17}/></span><b>{busy?'Reading documents…':'Add shipment documents'}</b><small>PDF, JPG, PNG · up to 20 MB each</small></button><input ref={inputRef} hidden type="file" multiple accept="application/pdf,image/*" onChange={e=>void addFiles(e.target.files)}/></div>
            <div className="card review-card"><div className="review-title"><div><div className="section-kicker">BEFORE FILING</div><h2>Needs your review <span>{reviews.length}</span></h2></div><button className="text-btn" onClick={()=>setTab('xml')}>View XML <ArrowRight size={13}/></button></div><div className="review-list">{reviews.slice(0,5).map((item,i)=><ReviewRow key={i} item={item}/>)}</div><button className="all-review" onClick={()=>setTab('xml')}>See all review notes <ArrowRight size={14}/></button></div>
            <div className="privacy-note"><ShieldCheck size={15}/><span>Documents stay in this local demo. No external AI service is called.</span></div>
          </aside>
        </div>}

        {tab==='documents'&&<div className="document-workspace"><div className="card document-card"><div className="card-header"><div><div className="section-kicker">SOURCE FILES</div><h2>Documents &amp; extracted text</h2><p>Text extraction is best effort. Confirm all values against the originals before filing.</p></div><button className="primary-btn small" onClick={()=>inputRef.current?.click()}><Plus size={15}/> Add documents</button></div><input ref={inputRef} hidden type="file" multiple accept="application/pdf,image/*" onChange={e=>void addFiles(e.target.files)}/>{docs.length===0?<div className="empty-docs"><div className="empty-icon"><Upload size={22}/></div><h3>Start with the shipment paperwork</h3><p>Upload a commercial invoice, packing list, bill of lading, or other shipment files.</p><button className="outline-btn" onClick={()=>inputRef.current?.click()}><Upload size={14}/> Choose files</button></div>:<div className="extracted-list">{docs.map((doc,i)=><article className="extracted-doc" key={`${doc.filename}-${i}`}><div className="extracted-header"><div className="file-icon f0"><FileText size={15}/></div><div><b>{doc.filename}</b><small>{fileSize(doc.bytes)} · {doc.parseError?'Extraction needs attention':'Text extracted'}</small></div><button className="text-btn" onClick={()=>setShowRaw(showRaw===doc.filename?null:doc.filename)}>{showRaw===doc.filename?'Hide text':'View extracted text'} <ChevronDown size={14}/></button></div>{doc.parseError&&<div className="parse-warning"><CircleAlert size={15}/>{doc.parseError}</div>}{showRaw===doc.filename&&<pre className="raw-text">{doc.text||'No selectable text was found in this file.'}</pre>}</article>)}</div>}</div><aside className="card extraction-side"><div className="section-kicker">EXTRACTION STATUS</div><h2>Evidence before entry</h2><p>Suggestions are copied into editable fields. Unclear or missing information stays open for human review.</p><div className="status-check"><Check size={15}/><span>Invoice number and bill number suggestions</span></div><div className="status-check muted"><Search size={15}/><span>Parties, dates, values, and line items</span></div><div className="status-check muted"><CircleAlert size={15}/><span>OCR for scanned/image-only PDFs</span></div><div className="honest-box"><b>What this prototype does</b><p>Extracts selectable PDF text and spots a small set of common identifiers. It does not infer HTSUS classifications or guarantee customs valuation.</p></div></aside></div>}

        {tab==='xml'&&<div className="xml-workspace"><section className="card xml-card"><div className="xml-toolbar"><div><div className="section-kicker">NETCHB ENTRY UPLOAD</div><h2>XML draft <span className="draft-pill"><span/> NOT FILED</span></h2><p>System-generated entry number · Upload schema order · Transmission disabled</p></div><div className="xml-actions"><button className="outline-btn" onClick={()=>void copyXml()}><Clipboard size={14}/> Copy</button><button className="primary-btn small" onClick={downloadXml}><ArrowDownToLine size={15}/> Download XML</button></div></div><div className="xml-code"><div className="code-top"><span className="code-dot red"/><span className="code-dot yellow"/><span className="code-dot green"/><span className="code-file">{draft.invoiceNo||'entry'}-netchb.xml</span><span className="code-mode">XML</span></div><pre>{xml||'Generating…'}</pre></div><div className="schema-foot"><Check size={15}/><span>Structured against the NetCHB Entry Upload XSD (entry.xsd)</span><span className="schema-foot-right">No transmit tag included</span></div></section><aside className="card xml-review"><div className="review-title"><div><div className="section-kicker">BROKER CHECKLIST</div><h2>{blocking} filing blockers</h2></div><span className="warning-count"><CircleAlert size={15}/></span></div><p className="review-intro">The XML is a structured draft. Resolve these questions with the broker before uploading to NetCHB.</p><div className="review-list full">{reviews.map((item,i)=><ReviewRow key={i} item={item}/>)}</div><div className="xml-disclaimer"><ShieldCheck size={16}/><p><b>Generated for review only.</b><br/>The XML may pass structural checks while still lacking filer-specific and legally required entry data.</p></div></aside></div>}
        <footer className="page-footer"><span>SEFER <span className="footer-dot">·</span> ENTRY WORKBENCH</span><span>Built for broker review <span className="footer-dot">·</span> NetCHB XML</span></footer>
      </div>
    </main>
    {toast&&<div className="toast"><Check size={15}/>{toast}</div>}
  </div>;
}

function Field({label,value,onChange,placeholder,type='text',source,hint,suffix,flag,readOnly}:{label:string;value:string|number;onChange:(v:string)=>void;placeholder?:string;type?:string;source?:string;hint?:string;suffix?:string;flag?:string;readOnly?:boolean}){
  return <label className="field"><span className="field-label">{label}{flag&&<em className="field-flag">{flag}</em>}</span><span className={`field-control ${readOnly?'read-only':''}`}><input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} readOnly={readOnly}/>{suffix&&<i>{suffix}</i>}</span><small>{source||hint||' '}</small></label>;
}
function ReviewRow({item}:{item:Review}){return <div className="review-item"><span className={`review-icon ${item.level}`}><CircleAlert size={14}/></span><div><b>{item.title}</b><p>{item.detail}</p></div></div>}

export default App;
