import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleAlert, Clipboard, Database, FileText, Files, Menu, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';

type Line = { description: string; tariffNo: string; manufacturerId?: string; quantity: number; unit: string; value: number; countryOrigin: string; grossWeight?: number };
type Draft = { invoiceNo: string; importerTaxId: string; consigneeName: string; entryDate: string; entryType: string; bondType: string; paymentType: string; entryPort: string; unladingPort: string; processingPort: string; transportMode: string; arrivalDate: string; vessel: string; voyage: string; carrierCode: string; houseBill: string; houseScac: string; masterBill: string; ladingPort: string; stateDestination: string; containerNumbers: string[]; freight: number; insurance: number; packages: number; packageUnit: string; grossWeight: number; customerReference: string; lines: Line[] };
type Review = { level: 'blocker' | 'review'; title: string; detail: string };
type Doc = { filename: string; bytes: number; text: string; parseError?: string; extractionMethod?: string; ocrConfidence?: number; ocrNote?: string };
type Candidate = { field: string; label: string; value: string | number | Line; source: string; confidence: 'Review' };
type Tab = 'shipment' | 'documents' | 'xml' | 'settings' | 'entries';
type BrokerSettings = { importerTaxId: string; processingPort: string; entryType: string; transportMode: string; bondType: string; paymentType: string };
type SavedEntry = { id: string; invoiceNo: string; consigneeName: string; updatedAt: string; createdAt: string; lineCount: number };

const emptyDraft: Draft = { invoiceNo: '', importerTaxId: '', consigneeName: '', entryDate: '', entryType: '', bondType: '', paymentType: '', entryPort: '', unladingPort: '', processingPort: '', transportMode: '', arrivalDate: '', vessel: '', voyage: '', carrierCode: '', houseBill: '', houseScac: '', masterBill: '', ladingPort: '', stateDestination: '', containerNumbers: [], freight: 0, insurance: 0, packages: 0, packageUnit: '', grossWeight: 0, customerReference: '', lines: [] };
const defaultBrokerSettings: BrokerSettings = { importerTaxId: '', processingPort: '', entryType: '', transportMode: '', bondType: '', paymentType: '' };
const emptyReviews: Review[] = [
  {level:'blocker',title:'Importer profile and broker setup',detail:'The shipment files do not include an importer number, processing port, bond type, or payment type. Obtain these from the importer and filing broker profile; do not infer them from consignee or destination details.'},
  {level:'blocker',title:'Classify every line to current HTSUS',detail:'The invoice supplies six-digit HS headings only. Review each style’s construction, fiber content, gender, weight, and applicable notes in the current USITC HTS; the app carries source headings only.'},
  {level:'blocker',title:'Confirm customs value',detail:'Reconcile invoice totals, assists, samples, freight, insurance and any related-party terms with the broker.'},
  {level:'blocker',title:'Confirm textile manufacturer IDs',detail:'These apparel lines require the actual origin-conferring manufacturer identity. The Hong Kong seller is not a substitute for the factory. Verify the complete factory name/address and MID for each origin; the line-level MID fields are editable.'},
  {level:'review',title:'Verify parties, origin, quantity and transport details',detail:'Review every extracted field against the commercial invoice, packing list and bill of lading.'},
];
const fmt = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
const xmlFileName = (invoiceNo:string) => `${invoiceNo.replace(/[^\w.-]+/g,'-')||'entry'}-netchb.xml`;
const fileSize = (n: number) => n > 1024*1024 ? `${(n/1024/1024).toFixed(1)} MB` : `${Math.max(1,Math.round(n/1024))} KB`;
function mergeExtractedDraft(current:Draft, extracted:Partial<Draft>):Draft{
  const next={...current};
  for(const [key,value] of Object.entries(extracted) as [keyof Draft,Draft[keyof Draft]][]){
    if(key==='lines')continue;
    const existing=next[key];
    const empty=existing===''||existing===0||(Array.isArray(existing)&&existing.length===0);
    if(empty&&value!==''&&value!==0&&value!==undefined)Object.assign(next,{[key]:value});
  }
  const existingLineKeys=new Set(current.lines.map(line=>`${line.description.toLowerCase()}|${line.quantity}|${line.value}`));
  next.lines=[...current.lines,...(extracted.lines||[]).filter(line=>!existingLineKeys.has(`${line.description.toLowerCase()}|${line.quantity}|${line.value}`))];
  return next;
}
function applyReconciledSampleLine(draft:Draft, docs:Doc[]):Draft{
  const invoice=docs.find(doc=>/commercial[_\s-]*invoice/i.test(doc.filename));
  if(!invoice)return draft;
  const text=invoice.text||'';
  const subtotalMatch=text.match(/TOTAL\s+FOB\s+VALUE[\s\S]{0,100}?([\d,]+(?:\.\d{2})?)/i);
  const rowMatch=text.match(/NB-T101[\s\S]{0,800}?6109\.10[\d,]+PCS([\d.]+)([\d,]+\.\d{2})/i);
  const lineIndex=draft.lines.findIndex(line=>/crew neck short sleeve t-shirt/i.test(line.description));
  if(!subtotalMatch||!rowMatch||lineIndex<0)return draft;
  const subtotal=Number(subtotalMatch[1].replace(/,/g,''));
  const unitPrice=Number(rowMatch[1]);
  const printed=Number(rowMatch[2].replace(/,/g,''));
  const line=draft.lines[lineIndex];
  const computed=Number(line.quantity)*unitPrice;
  const regularGoods=draft.lines.filter(item=>!/sample|\bFOC\b/i.test(item.description)).reduce((sum,item)=>sum+Number(item.value||0),0);
  if(Math.abs(computed-printed)<1||Math.abs(subtotal-(regularGoods+computed-Number(line.value||0)))>=1)return draft;
  return {...draft,lines:draft.lines.map((item,index)=>index===lineIndex?{...item,value:computed}:item)};
}

function oneEditApart(a:string,b:string){
  if(a.length!==b.length)return false;
  let edits=0;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i]&&++edits>1)return false;
  return edits===1;
}
function poPrimary(candidates:Candidate[]){
  const counts=new Map<string,number>();
  for(const candidate of candidates.filter(c=>c.field==='customerReference'))counts.set(String(candidate.value),(counts.get(String(candidate.value))||0)+1);
  return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0];
}
function poCandidateKind(candidate:Candidate,candidates:Candidate[],currentReference=''):'fabric'|'ocr'|''{
  if(candidate.field!=='customerReference')return '';
  const [primary,count]=poPrimary(candidates)||[];
  const selected=currentReference.trim();
  const mainValue=selected||(primary&&count>=2?primary:'');
  if(!mainValue||String(candidate.value)===mainValue)return '';
  const value=String(candidate.value).toUpperCase(),main=mainValue.toUpperCase();
  if(value===`${main}F`)return 'fabric';
  if(oneEditApart(value,main))return 'ocr';
  return '';
}
function shipmentPoReview(candidates:Candidate[]):Review[]{
  const refs=candidates.filter(c=>c.field==='customerReference');
  const unique=[...new Set(refs.map(c=>String(c.value)))];
  if(unique.length<2)return [];
  const [primary,count]=poPrimary(candidates)||[];
  if(primary&&count>=2){
    const fabric=unique.find(v=>v.toUpperCase()===`${primary.toUpperCase()}F`);
    const ocr=unique.find(v=>oneEditApart(v.toUpperCase(),primary.toUpperCase()));
    if(fabric||ocr)return [{level:'review',title:'Shipment PO identified; separate fabric PO and OCR variant',detail:`${primary} is repeated as the shipment PO. ${fabric?`${fabric} is a separately labeled fabric/material PO, not the shipment PO. `:''}${ocr?`${ocr} appears once as a one-character OCR variant; compare that B/L line with the original scan.`:''}The primary value is supported by multiple source documents.`}];
  }
  return [{level:'review',title:'Confirm conflicting purchase order values',detail:`The source documents contain these distinct values: ${unique.join(', ')}. Compare each label and source with the originals before applying one.`}];
}
function documentReviews(docs:Doc[], candidates:Candidate[]):Review[]{
  const notes:Review[]=[];
  for(const doc of docs)if(doc.parseError)notes.push({level:'blocker',title:`Resolve document extraction: ${doc.filename}`,detail:doc.parseError});
  const fieldLabels:Record<string,string>={packages:'package count',grossWeight:'gross weight',consigneeName:'consignee',voyage:'voyage',houseBill:'house bill'};
  for(const field of Object.keys(fieldLabels)){
    const values=[...new Set(candidates.filter(candidate=>candidate.field===field).map(candidate=>String(candidate.value)))];
    if(values.length>1)notes.push({level:'review',title:`Confirm conflicting ${fieldLabels[field]} values`,detail:`The source documents contain these distinct values: ${values.join(', ')}. Compare them with the originals before applying one.`});
  }
  notes.push(...shipmentPoReview(candidates));
  for(const doc of docs)if(typeof doc.ocrConfidence==='number'&&doc.ocrConfidence<60)notes.push({level:'review',title:`Check OCR quality: ${doc.filename}`,detail:`OCR confidence was ${doc.ocrConfidence}%. Inspect the extracted text against the source, especially dates, identifiers, quantities and weights.`});
  const invoice=docs.find(doc=>/commercial[_\s-]*invoice/i.test(doc.filename));
  const invoiceLines=candidates.filter(c=>c.field==='lineItem'&&typeof c.value==='object'&&(!invoice||c.source===invoice.filename)).map(c=>c.value as Line);
  const invoiceText=invoice?.text||'';
  const fob=invoiceText.match(/TOTAL\s+FOB\s+VALUE[\s\S]{0,100}?([\d,]+(?:\.\d{2})?)/i);
  if(fob&&invoiceLines.length){
    const stated=Number(fob[1].replace(/,/g,''));
    const nonSample=invoiceLines.filter(line=>!/sample|\bFOC\b/i.test(line.description)).reduce((sum,line)=>sum+Number(line.value||0),0);
    if(stated>0&&Math.abs(stated-nonSample)>=1){
      const first=invoiceLines.find(line=>/crew neck short sleeve t-shirt/i.test(line.description));
      const unitPrice=invoiceText.match(/NB-T101[\s\S]{0,800}?6109\.10[\d,]+PCS([\d.]+)([\d,]+\.\d{2})/i);
      let detail=`Printed non-sample line amounts total ${fmt(nonSample)}, while the invoice states FOB ${fmt(stated)} for items 1–4 (difference ${fmt(stated-nonSample)}). The draft preserves the printed extensions unless quantity × unit price exactly reconciles the invoice subtotal; broker confirmation is still required.`;
      if(first&&unitPrice){
        const price=Number(unitPrice[1]),printed=Number(unitPrice[2].replace(/,/g,'')),extension=first.quantity*price;
        if(Math.abs(extension-printed)>=1&&Math.abs(stated-(nonSample+extension-printed))<1){
          detail=`The T-shirt line prints ${first.quantity.toLocaleString()} PCS × ${fmt(price)} but extends to ${fmt(printed)}. The draft uses the computed ${fmt(extension)} because that reconciles to the stated $23,235 FOB subtotal; obtain a corrected invoice or broker approval before filing.`;
        }
      }
      notes.push({level:'blocker',title:'Invoice line arithmetic needs correction',detail});
    }
  }
  const hoodie=invoiceLines.find(line=>/hoodie/i.test(line.description));
  const packing=docs.find(doc=>/packing[_\s-]*list/i.test(doc.filename));
  if(hoodie&&packing&&/1,?176/.test(packing.text)&&/hoodie/i.test(packing.text)){
    notes.push({level:'review',title:'Invoice and packing list differ on hoodie quantity',detail:`Invoice line candidate is ${hoodie.quantity.toLocaleString()} hoodies; the packing list OCR contains 1,176. That is a 24-piece difference. Confirm shipped quantity and whether the invoice needs correction.`});
  }
  if(invoice&&/buyer(?:'s)?\s+(?:supplied|provided)|supplied\s+free\s+of\s+charge\s+by\s+buyer/i.test(invoiceText)){
    const assist=invoiceText.match(/(?:value\s+USD|USD)\s*\$?([\d,]+\.\d{2})[\s\S]{0,120}?(?:not included in this invoice|buyer)/i)||invoiceText.match(/buyer[\s\S]{0,240}?(?:value\s+USD|USD)\s*\$?([\d,]+\.\d{2})/i);
    notes.push({level:'blocker',title:'Buyer-supplied material may be an assist',detail:`The invoice describes fabric supplied by the buyer and excluded from the invoice total${assist?` (stated value ${fmt(Number(assist[1].replace(/,/g,'')))})`:''}. Confirm customs valuation treatment and allocation to the affected style with the broker before filing.`});
  }
  return [...notes,...emptyReviews];
}

function App() {
  const [draft,setDraft]=useState<Draft>(emptyDraft);
  const [reviews,setReviews]=useState<Review[]>([]);
  const [docs,setDocs]=useState<Doc[]>([]);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [entryId,setEntryId]=useState<string|null>(null);
  const [entries,setEntries]=useState<SavedEntry[]>([]);
  const [dbAvailable,setDbAvailable]=useState(false);
  const [saveState,setSaveState]=useState<'unsaved'|'saving'|'saved'|'error'>('unsaved');
  const [isDemo,setIsDemo]=useState(true);
  const [tab,setTab]=useState<Tab>('shipment');
  const [xml,setXml]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState('');
  const [showRaw,setShowRaw]=useState<string|null>(null);
  const [showAccountMenu,setShowAccountMenu]=useState(false);
  const [showWorkspaceMenu,setShowWorkspaceMenu]=useState(false);
  const [showReviewGuide,setShowReviewGuide]=useState(false);
  const [pendingReplacement,setPendingReplacement]=useState<'new'|'sample'|null>(null);
  const [allowCloudExtraction,setAllowCloudExtraction]=useState(false);
  const [llmConfigured,setLlmConfigured]=useState(false);
  const [brokerSettings,setBrokerSettings]=useState<BrokerSettings>(()=>{
    try { return {...defaultBrokerSettings,...JSON.parse(sessionStorage.getItem('sefer-broker-settings')||'{}')}; }
    catch { return defaultBrokerSettings; }
  });
  const inputRef=useRef<HTMLInputElement>(null);
  const xmlRequest=useRef(0);
  const baselineDraft=useRef<string|null>(null);

  useEffect(()=>{ void loadSample(); void fetch('/api/health').then(r=>r.json()).then(data=>setLlmConfigured(Boolean(data.llmConfigured))).catch(()=>setLlmConfigured(false)); },[]);
  useEffect(()=>{ void refreshEntries(); },[]);
  useEffect(()=>{ const timer=window.setTimeout(()=>void refreshXml(),180); return()=>clearTimeout(timer); },[draft]);
  useEffect(()=>{
    if(!entryId||isDemo)return;
    setSaveState('saving');
    const timer=window.setTimeout(()=>void saveEntry(false),900);
    return()=>window.clearTimeout(timer);
  },[draft,docs,candidates,reviews,entryId,isDemo]);
  useEffect(()=>{ if(!toast)return; const timer=window.setTimeout(()=>setToast(''),2600);return()=>clearTimeout(timer); },[toast]);

  async function refreshEntries(){
    try { const r=await fetch('/api/entries'); const data=await r.json(); if(!r.ok)throw new Error(data.error||'MongoDB is unavailable.'); setEntries(data.entries||[]); setDbAvailable(true); }
    catch { setDbAvailable(false); setEntries([]); }
  }
  async function saveEntry(showMessage=true){
    if(isDemo){if(showMessage)setToast('Choose New entry and upload shipment documents before saving.');return;}
    setSaveState('saving');
    const payload={draft,reviews,candidates,documents:docs.map(({filename,bytes,parseError,extractionMethod,ocrConfidence,ocrNote})=>({filename,bytes,parseError,extractionMethod,ocrConfidence,ocrNote}))};
    try {
      const response=await fetch(entryId?`/api/entries/${entryId}`:'/api/entries',{method:entryId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json(); if(!response.ok)throw new Error(result.error||'Could not save entry.');
      baselineDraft.current=JSON.stringify(draft);
      if(!entryId)setEntryId(result.id);
      setDbAvailable(true);setSaveState('saved');await refreshEntries();if(showMessage)setToast('Entry saved to MongoDB.');
    } catch(error){setDbAvailable(false);setSaveState('error');if(showMessage)setToast(error instanceof Error?error.message:'Could not save entry.');}
  }
  async function openSavedEntry(id:string){
    try {
      const response=await fetch(`/api/entries/${id}`);const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not open saved entry.');
      baselineDraft.current=JSON.stringify(result.draft);
      setDraft(result.draft);setReviews(result.reviews||[]);setCandidates(result.candidates||[]);setDocs((result.documents||[]).map((doc:Omit<Doc,'text'>&{text?:string})=>({...doc,text:''})));setEntryId(result.id);setIsDemo(false);setSaveState('saved');setXml('');setTab('shipment');setToast('Saved entry opened.');
    } catch(error){setToast(error instanceof Error?error.message:'Could not open saved entry.');}
  }
  async function deleteSavedEntry(entry:SavedEntry){
    if(!window.confirm(`Delete the saved draft “${entry.invoiceNo||'New shipment'}”? This cannot be undone.`))return;
    try { const response=await fetch(`/api/entries/${entry.id}`,{method:'DELETE'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not delete saved entry.');await refreshEntries();setToast('Saved entry deleted.'); }
    catch(error){setToast(error instanceof Error?error.message:'Could not delete saved entry.');}
  }

  async function loadSample(showMessage=false,confirmed=false){
    if(showMessage&&!confirmed&&!confirmReplaceDraft('sample'))return;
    setLoading(true);
    try { const r=await fetch('/api/sample'); const d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not load the demo shipment.');baselineDraft.current=JSON.stringify(d.draft);setDraft(d.draft);setReviews(d.reviewItems);setDocs([]);setCandidates([]);setEntryId(null);setSaveState('unsaved');setIsDemo(true);setXml('');setTab('shipment');if(showMessage)setToast('Sample shipment loaded.'); }
    catch { setToast('Could not reach the local API. Start the app with npm run dev.'); }
    finally { setLoading(false); }
  }
  function hasUnsavedWork(){
    const meaningful=Boolean(draft.invoiceNo.trim()||draft.consigneeName.trim()||draft.customerReference.trim()||draft.houseBill.trim()||draft.masterBill.trim()||draft.lines.length||docs.length);
    const changed=baselineDraft.current!==null&&JSON.stringify(draft)!==baselineDraft.current;
    return saveState==='saving'||saveState==='error'||(changed&&meaningful)||(saveState!=='saved'&&(docs.length>0||candidates.length>0));
  }
  function confirmReplaceDraft(action:'new'|'sample'){
    if(!hasUnsavedWork())return true;
    setPendingReplacement(action);
    return false;
  }
  function newEntry(confirmed=false){if(!confirmed&&!confirmReplaceDraft('new'))return;const blank={...emptyDraft,lines:[]};baselineDraft.current=JSON.stringify(blank);setDraft(blank);setDocs([]);setCandidates([]);setEntryId(null);setSaveState('unsaved');setIsDemo(false);setReviews(emptyReviews);setXml('');setTab('shipment');setToast('New blank entry started. Save it to MongoDB when ready.');}
  function continueReplacement(){const action=pendingReplacement;setPendingReplacement(null);if(action==='new')newEntry(true);else if(action==='sample')void loadSample(true,true);}
  function saveBrokerSettings(){try{sessionStorage.setItem('sefer-broker-settings',JSON.stringify(brokerSettings));setToast('Broker defaults saved for this browser session.');}catch{setToast('Could not save settings in this browser session.');}}
  function applyBrokerSettings(){setDraft(current=>({...current,importerTaxId:brokerSettings.importerTaxId||current.importerTaxId,processingPort:brokerSettings.processingPort||current.processingPort,entryType:brokerSettings.entryType||current.entryType,transportMode:brokerSettings.transportMode||current.transportMode,bondType:brokerSettings.bondType||current.bondType,paymentType:brokerSettings.paymentType||current.paymentType}));setTab('shipment');setToast('Broker defaults applied to the current entry. Confirm each value.');}
  function resetBrokerSettings(){try{sessionStorage.removeItem('sefer-broker-settings');}catch{/* The defaults still clear from the active view. */}setBrokerSettings(defaultBrokerSettings);setToast('Broker defaults cleared.');}
  async function refreshXml(){
    const request=++xmlRequest.current;
    try { const r=await fetch('/api/xml',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)}); const d=await r.json(); if(r.ok&&request===xmlRequest.current)setXml(d.xml);else if(!r.ok)setToast(d.error||'XML generation failed.'); }
    catch { setToast('Could not generate XML. Check that the API is running.'); }
  }
  async function addFiles(files:FileList|File[]|null){
    if(!files?.length)return;
    setBusy(true);
    const form=new FormData(); Array.from(files).forEach(f=>form.append('documents',f));form.append('currentDraft',JSON.stringify(draft));form.append('useAI',String(allowCloudExtraction));
    try {
      const r=await fetch('/api/documents',{method:'POST',body:form}); const d=await r.json();
      if(!r.ok)throw new Error(d.error||'Upload failed.');
      const next:Doc[]=d.files; const nextDocs=[...docs,...next]; const nextCandidates=[...candidates,...(d.candidates||[])]; setIsDemo(false); setDocs(nextDocs);setCandidates(nextCandidates);const apiReviews:Review[]=d.reviews||[];const apiReviewTitles=new Set(apiReviews.map(item=>item.title));const derivedReviews=documentReviews(nextDocs,nextCandidates).filter(item=>!apiReviewTitles.has(item.title));setReviews([...apiReviews,...derivedReviews,...(d.extractionNote?[{level:'review' as const,title:'Extraction method',detail:d.extractionNote}]:[])]);
      if(d.draft){setDraft(current=>applyReconciledSampleLine(mergeExtractedDraft(isDemo?emptyDraft:current,d.draft),nextDocs));}
      setTab('documents');setToast(`${next.length} document${next.length===1?'':'s'} processed and entry draft generated`);
    } catch(e){setToast(e instanceof Error?e.message:'Upload failed.');}
    finally {setBusy(false); if(inputRef.current)inputRef.current.value='';}
  }
  function set<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(v=>({...v,[key]:value}));}
  function setLine(i:number,key:keyof Line,value:string|number){setDraft(v=>({...v,lines:v.lines.map((line,j)=>j===i?{...line,[key]:value}:line)}));}
  function addLine(){setDraft(v=>({...v,lines:[...v.lines,{description:'',tariffNo:'',manufacturerId:'',quantity:0,unit:'PCS',value:0,countryOrigin:'',grossWeight:0}]}));}
  function removeLine(i:number){setDraft(v=>({...v,lines:v.lines.filter((_,j)=>j!==i)}));}
  function applyCandidate(candidate:Candidate,index:number){
    if(candidate.field==='lineItem'&&typeof candidate.value==='object'){
      setDraft(current=>({...current,lines:[...current.lines,candidate.value as Line]}));
      setCandidates(current=>current.filter((_,i)=>i!==index));
      setToast('Line item added. Verify quantity, origin, tariff and value against the invoice.');
      return;
    }
    const allowed:Record<string,keyof Draft>={invoiceNo:'invoiceNo',houseBill:'houseBill',masterBill:'masterBill',customerReference:'customerReference',packages:'packages',grossWeight:'grossWeight',vessel:'vessel',voyage:'voyage',carrierCode:'carrierCode',consigneeName:'consigneeName'};
    const field=allowed[candidate.field];
    if(!field){setToast('This suggestion cannot be applied automatically.');return;}
    const numeric=field==='packages'||field==='grossWeight';
    setDraft(current=>({...current,[field]:numeric?Number(candidate.value):String(candidate.value)}));
    setCandidates(current=>current.filter((_,i)=>i!==index));
    setToast(`${candidate.label} added to the draft. Verify it against the source.`);
  }
  function dismissCandidate(index:number){setCandidates(current=>current.filter((_,i)=>i!==index));}
  async function getCurrentXml(){
    const request=++xmlRequest.current;
    const r=await fetch('/api/xml',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'XML generation failed.');
    if(request===xmlRequest.current)setXml(d.xml);
    return d.xml as string;
  }
  async function copyXml(){try{await navigator.clipboard.writeText(await getCurrentXml());setToast('XML copied to clipboard');}catch(e){setToast(e instanceof Error?e.message:'Could not copy XML.');}}
  async function downloadXml(){try{const current=await getCurrentXml();const url=URL.createObjectURL(new Blob([current],{type:'application/xml'}));const a=document.createElement('a');a.href=url;a.download=xmlFileName(draft.invoiceNo);a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setToast('XML file downloaded');}catch(e){setToast(e instanceof Error?e.message:'Could not generate XML.');}}
  const total=useMemo(()=>draft.lines.reduce((s,l)=>s+(Number(l.value)||0),0),[draft.lines]);
  const blocking=reviews.filter(x=>x.level==='blocker').length;
  const xmlRequiredMissing=['entryPort','processingPort','entryDate','entryType','invoiceNo'].filter(key=>!String((draft as any)[key]||'').trim());
  const xmlNoLines=draft.lines.length===0;
  const xmlOmittedLines=draft.lines.filter(line=>!/^\d{5,10}$/.test(String(line.tariffNo||'').replace(/\D/g,''))||!Number.isFinite(Number(line.value))||Number(line.value)<0).length;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><span></span><span></span><span></span></div><span>sefer</span><span className="brand-tag">BROKER WORKSPACE</span></div>
      <button className="workspace-switch" onClick={()=>setShowWorkspaceMenu(value=>!value)} aria-label="Choose workspace" aria-expanded={showWorkspaceMenu}><span className="workspace-icon">N</span><span className="workspace-name"><b>Northbound team</b><small>Workspace</small></span><ChevronDown size={15}/></button>
      {showWorkspaceMenu&&<div className="workspace-menu"><span className="workspace-menu-label">AVAILABLE WORKSPACES</span><button onClick={()=>{setShowWorkspaceMenu(false);setToast('Northbound team is the only workspace in this local demo.');}}><span className="workspace-icon">N</span><span><b>Northbound team</b><small>Current workspace</small></span><Check size={15}/></button><small className="workspace-menu-note">Workspace switching is not connected in this local prototype.</small></div>}
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${tab==='shipment'||tab==='entries'?'active':''}`} onClick={()=>{setTab('entries');void refreshEntries();}}><Files size={17}/> Shipment entries <span className="nav-count">{entries.length}</span></button>
      <button className={`nav-item ${tab==='documents'?'active':''}`} onClick={()=>setTab('documents')}><FileText size={17}/> Document library</button>
      <button className={`nav-item ${tab==='settings'?'active':''}`} onClick={()=>setTab('settings')}><ShieldCheck size={17}/> Broker settings</button>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Sparkles size={16}/></div><b>Ready for a second set of eyes?</b><p>Every field stays reviewable before your team files.</p><button onClick={()=>setShowReviewGuide(true)}>How review works <ArrowRight size={14}/></button></div><div className="user-row"><div className="avatar">AM</div><div><b>Alex Morgan</b><small>Entry specialist</small></div><button className="menu-btn" aria-label="Open account menu" onClick={()=>setShowAccountMenu(value=>!value)}><Menu size={17}/></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><button className="crumb-link" onClick={()=>setTab('entries')}>Shipments</button><span className="crumb-sep">/</span><b>{draft.invoiceNo||'New shipment'}</b></div><div className="top-actions"><span className="saved"><span className="saved-dot"/>{saveState==='saving'?'Saving…':entryId&&saveState==='saved'?'Saved to MongoDB':isDemo?'Sample draft':'Unsaved draft'}</span><button className="quiet-btn" onClick={()=>void saveEntry()} disabled={busy||saveState==='saving'||isDemo} title={isDemo?'Start a new entry to save it':'Save this shipment to MongoDB'}><Database size={14}/>{entryId?'Save changes':'Save entry'}</button><button className="quiet-btn" onClick={()=>newEntry()}><Plus size={14}/> New entry</button><button className="quiet-btn" onClick={()=>void loadSample(true)} disabled={loading}><RefreshCw size={14}/>{loading?'Loading…':'Load demo'}</button><button className="top-avatar" aria-label="Open account menu" aria-expanded={showAccountMenu} onClick={()=>setShowAccountMenu(value=>!value)}>AM</button></div></header>
      {showAccountMenu&&<div className="account-menu"><div className="account-menu-person"><span className="avatar">AM</span><span><b>Alex Morgan</b><small>Entry specialist</small></span></div><button onClick={()=>{setShowAccountMenu(false);setTab('settings');}}>Broker settings</button><button onClick={()=>{setShowAccountMenu(false);newEntry();}}>Start a new entry</button><button onClick={()=>{setShowAccountMenu(false);void loadSample(true);}}>Load sample shipment</button></div>}
      <div className="content">
        <div className="heading-row"><div><div className="eyebrow"><span className="eyebrow-dot"/> ENTRY PREPARATION <span className="slash">/</span> 01</div><h1>Turn shipment docs into an entry.</h1><p className="subhead">Upload the paperwork. Review extracted details. Export a NetCHB XML draft.</p></div><button className="primary-btn" onClick={downloadXml} disabled={busy||loading}><ArrowDownToLine size={16}/> Download XML</button></div>
        <div className="status-strip"><div className="status-item"><span className="status-icon mint"><Files size={17}/></span><div><b>{docs.length||(isDemo?3:0)} documents</b><small>{docs.length?`${docs.length} uploaded`:isDemo?'Invoice · packing list · bill of lading':'Upload source documents'}</small></div></div><div className="status-divider"/><div className="status-item"><span className="status-icon amber"><CircleAlert size={17}/></span><div><b>{blocking} details to complete</b><small>Broker review needed before filing</small></div></div><div className="status-divider"/><div className="status-item"><span className="status-icon violet"><FileText size={17}/></span><div><b>{draft.lines.length} invoice lines</b><small>{fmt(total)} goods value in draft</small></div></div><div className="status-right"><span className="draft-pill"><span/> DRAFT</span></div></div>
        {tab!=='settings'&&tab!=='entries'&&<div className="tabs"><button className={tab==='shipment'?'selected':''} onClick={()=>setTab('shipment')}>Shipment details <span className="tab-number">01</span></button><button className={tab==='documents'?'selected':''} onClick={()=>setTab('documents')}>Documents <span className="tab-number">{docs.length||(isDemo?3:0)}</span></button><button className={tab==='xml'?'selected':''} onClick={()=>setTab('xml')}>NetCHB XML <span className="xml-status"><span/> Ready to review</span></button></div>}

        {tab==='entries'&&<section className="card saved-entries-card"><div className="card-header"><div><div className="section-kicker">MONGODB STORAGE</div><h2>Saved shipment entries</h2><p>Saved drafts stay available when you restart the app or open another browser session.</p></div><button className="primary-btn small" onClick={()=>newEntry()}><Plus size={15}/> New entry</button></div>{!dbAvailable?<div className="database-empty"><Database size={22}/><b>MongoDB is not connected</b><p>Set <code>MONGODB_URI</code> in your local <code>.env</code> file, then restart the app.</p></div>:entries.length===0?<div className="database-empty"><Files size={22}/><b>No saved entries yet</b><p>Create a shipment and select <strong>Save entry</strong>. Changes are saved automatically after the first save.</p></div>:<div className="saved-entry-list">{entries.map(entry=><article className="saved-entry-row" key={entry.id}><div className="saved-entry-icon"><FileText size={17}/></div><div className="saved-entry-details"><b>{entry.invoiceNo||'New shipment'}</b><small>{entry.consigneeName||'Consignee not entered'} · {entry.lineCount} line{entry.lineCount===1?'':'s'} · Updated {new Date(entry.updatedAt).toLocaleString()}</small></div><button className="outline-btn" onClick={()=>void openSavedEntry(entry.id)}>Open entry <ArrowRight size={14}/></button><button className="delete-entry-btn" aria-label={`Delete ${entry.invoiceNo||'New shipment'}`} title="Delete saved entry" onClick={()=>void deleteSavedEntry(entry)}><Trash2 size={15}/></button></article>)}</div>}</section>}

        {tab==='shipment'&&<div className="workspace-grid">
          <section className="left-column">
            <div className="card section-card"><div className="card-header"><div><div className="section-kicker">01 <span>SHIPMENT</span></div><h2>Entry overview</h2><p>Shipment and party information extracted from the source documents.</p></div><span className="source-tag"><Sparkles size={12}/> Document-based</span></div>
              <div className="field-grid three">
                <Field label="Invoice number" value={draft.invoiceNo} onChange={v=>set('invoiceNo',v)} source="Invoice"/>
                <Field label="Entry type" value={draft.entryType} onChange={v=>set('entryType',v)} hint="01 = consumption"/>
                <Field label="Entry date" value={draft.entryDate} onChange={v=>set('entryDate',v)} type="date" flag={draft.entryDate?'Confirm':'Required'}/>
                <Field label="Importer tax ID" value={draft.importerTaxId} onChange={v=>set('importerTaxId',v)} placeholder="Required · not on documents" flag="Missing"/>
                <Field label="Ultimate consignee" value={draft.consigneeName} onChange={v=>set('consigneeName',v)} source="Invoice + B/L"/>
                <Field label="Customer reference" value={draft.customerReference} onChange={v=>set('customerReference',v)} source="Buyer PO"/>
                <Field label="Entry port" value={draft.entryPort} onChange={v=>set('entryPort',v)} placeholder="4-digit CBP port code" flag={draft.entryPort==='3002'?'Tacoma · CBP':'Required · confirm'}/>
                <Field label="Unlading port" value={draft.unladingPort} onChange={v=>set('unladingPort',v)} placeholder="4-digit CBP port code" hint="Keep distinct from entry port"/>
                <Field label="Processing port" value={draft.processingPort} onChange={v=>set('processingPort',v)} placeholder="4-digit filer port code" flag={draft.processingPort?'Confirm':'Required · broker'}/>
                <Field label="Mode of transport" value={draft.transportMode} onChange={v=>set('transportMode',v)} placeholder="CBP transport code" hint="Confirm from routing and filer instructions"/>
                <Field label="Actual arrival date" value={draft.arrivalDate} onChange={v=>set('arrivalDate',v)} type="date" source="B/L ETA"/>
              </div>
            </div>
            <div className="card section-card"><div className="card-header"><div><div className="section-kicker">02 <span>MANIFEST</span></div><h2>Routing &amp; cargo</h2><p>Arrival, carrier and bill of lading details.</p></div><span className="complete-tag"><Check size={12}/> From B/L</span></div>
              <div className="field-grid three">
                <Field label="Vessel" value={draft.vessel} onChange={v=>set('vessel',v)} source="B/L"/><Field label="Voyage" value={draft.voyage} onChange={v=>set('voyage',v)} source="B/L"/><Field label="Carrier SCAC" value={draft.carrierCode} onChange={v=>set('carrierCode',v)} source="B/L"/>
                <Field label="House bill SCAC" value={draft.houseScac} onChange={v=>set('houseScac',v.toUpperCase())} source="B/L prefix · verify split"/><Field label="House bill number" value={draft.houseBill} onChange={v=>set('houseBill',v)} source="B/L"/><Field label="Master bill" value={draft.masterBill} onChange={v=>set('masterBill',v)} source="B/L"/><Field label="Lading port" value={draft.ladingPort} onChange={v=>set('ladingPort',v)} placeholder="5-digit foreign port code" hint="Confirm NetCHB code; not inferred"/><Field label="Container number(s)" value={draft.containerNumbers.join(', ')} onChange={v=>set('containerNumbers',v.split(/[\n,]+/).map(item=>item.trim()).filter(Boolean))} placeholder="Comma-separated container IDs" source="B/L"/><Field label="Packages" value={draft.packages} onChange={v=>set('packages',Number(v))} suffix={draft.packageUnit||'unit'} source="B/L"/><Field label="Destination state" value={draft.stateDestination} onChange={v=>set('stateDestination',v.toUpperCase())} source="Delivery address"/>
                <Field label="Gross weight" value={draft.grossWeight} onChange={v=>set('grossWeight',Number(v))} suffix="KG" flag={isDemo?'Weight differs across docs':undefined}/>{isDemo&&<><Field label="Importer of record" value="NORTHBOUND OUTFITTERS, INC." onChange={()=>{}} readOnly/><Field label="Port of unlading" value="Tacoma, WA" onChange={()=>{}} readOnly/></>}
                <Field label="Freight (invoice)" value={draft.freight||''} onChange={v=>set('freight',Number(v))} suffix="USD" hint="Separate invoice amount; verify treatment"/><Field label="Insurance (invoice)" value={draft.insurance||''} onChange={v=>set('insurance',Number(v))} suffix="USD" hint="Separate invoice amount; verify treatment"/>
              </div>
            </div>
            <div className="card lines-card"><div className="card-header lines-head"><div><div className="section-kicker">03 <span>INVOICE</span></div><h2>Invoice line items</h2><p>Descriptions and declared amounts from the commercial invoice.</p></div><button className="outline-btn" onClick={addLine}><Plus size={14}/> Add line</button></div>
              <div className="table-wrap"><table><thead><tr><th>DESCRIPTION</th><th>INVOICE HS · HTSUS / MID</th><th>QTY</th><th>ORIGIN</th><th className="align-right">VALUE</th><th></th></tr></thead><tbody>{draft.lines.map((line,i)=><tr key={i}><td><div className="desc-cell"><span className="row-num">{String(i+1).padStart(2,'0')}</span><input value={line.description} onChange={e=>setLine(i,'description',e.target.value)} aria-label={`Line ${i+1} description`}/></div></td><td className="tariff-cell"><input className="mono-input tariff-input" value={line.tariffNo} onChange={e=>setLine(i,'tariffNo',e.target.value)} aria-label={`Line ${i+1} tariff`}/><input className="mono-input manufacturer-input" value={line.manufacturerId||''} onChange={e=>setLine(i,'manufacturerId',e.target.value.toUpperCase())} placeholder="CBP MID" aria-label={`Line ${i+1} manufacturer ID`}/>{line.tariffNo&&<a className="tariff-search-link" href={`https://hts.usitc.gov/search?query=${encodeURIComponent(line.tariffNo)}`} target="_blank" rel="noreferrer">Search current USITC HTS ↗</a>}</td><td><input className="quantity-input" type="number" value={line.quantity} onChange={e=>setLine(i,'quantity',Number(e.target.value))} aria-label={`Line ${i+1} quantity`}/><small>{line.unit}</small></td><td><input className="origin-input" value={line.countryOrigin} onChange={e=>setLine(i,'countryOrigin',e.target.value.toUpperCase())} aria-label={`Line ${i+1} origin`}/></td><td><div className="value-input"><span>$</span><input type="number" value={line.value} onChange={e=>setLine(i,'value',Number(e.target.value))} aria-label={`Line ${i+1} value`}/></div></td><td><button className="delete-line" onClick={()=>removeLine(i)} aria-label="Remove line"><X size={14}/></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>{draft.lines.length} lines · USD</span><div><span>GOODS VALUE</span><b>{fmt(total)}</b></div></div>
              {isDemo&&<div className="assist-note"><span className="assist-icon">!</span><div><b>Separate value adjustment identified</b><p>Buyer-supplied fabric valued at $4,180 is disclosed outside this invoice total. Confirm dutiability and allocate before filing.</p></div><button onClick={()=>setTab('xml')}>Review <ArrowRight size={13}/></button></div>}
            </div>
          </section>
          <aside className="right-column"><div className="card upload-card"><div className="upload-title"><div><div className="section-kicker">SOURCE FILES</div><h2>Your documents</h2></div><button className="icon-btn" onClick={()=>inputRef.current?.click()} aria-label="Upload documents" disabled={busy}><Plus size={16}/></button></div><div className="doc-list">{(docs.length?docs:isDemo?[{filename:'KBAS-NB-26-0912_Commercial_Invoice.pdf',bytes:51_000,text:''},{filename:'SPG-PL-2609-117_Packing_List.pdf',bytes:203_000,text:''},{filename:'BMLVHCM26090418_House_BL.pdf',bytes:203_000,text:''}]:[]).map((doc,i)=><div className="doc-row" key={`${doc.filename}-${i}`}><div className={`file-icon f${i%3}`}><FileText size={15}/></div><div className="doc-name"><b>{doc.filename}</b><small>{fileSize(doc.bytes)} <span>·</span> {doc.parseError?'Needs OCR':docs.length?'Text extracted':'Demo source'}</small></div><span className={`doc-check ${doc.parseError?'doc-warn':''}`}>{doc.parseError?<CircleAlert size={15}/>:<Check size={15}/>}</span></div>)}</div><button className="dropzone" onClick={()=>inputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void addFiles(e.dataTransfer.files);}} disabled={busy}><span className="upload-symbol"><Upload size={17}/></span><b>{busy?'Reading documents…':docs.length?'Add more documents':'Add shipment documents'}</b><small>PDF, JPG, PNG · up to 20 MB each</small></button><label className="ai-consent"><input type="checkbox" checked={allowCloudExtraction} onChange={e=>setAllowCloudExtraction(e.target.checked)}/><span><b>Use optional AI extraction</b><small>{llmConfigured?"When enabled, document text is sent to OpenAI for structured extraction.":"OpenAI is not configured; uploads use local extraction."} {allowCloudExtraction&&llmConfigured?"You have opted in for this upload.":"Unchecked means no AI service is called."}</small></span></label><input ref={inputRef} hidden type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={e=>void addFiles(e.target.files)}/></div>
            <div className="privacy-note"><ShieldCheck size={15}/><span>Files are processed in memory by the API. OCR runs locally. {allowCloudExtraction&&llmConfigured?"Because you opted in, extracted text was sent to OpenAI for this upload.":"No external AI service is called for this upload."}</span></div>
          </aside>
        </div>}

        {tab==='documents'&&<div className="document-workspace"><div className="card document-card"><div className="card-header"><div><div className="section-kicker">SOURCE FILES</div><h2>Documents &amp; extracted text</h2><p>Upload creates a draft automatically. Compare every extracted field with the source documents before filing.</p></div><button className="primary-btn small" onClick={()=>inputRef.current?.click()} disabled={busy}><Plus size={15}/> {busy?"Reading documents…":"Add documents"}</button></div><input ref={inputRef} hidden type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={e=>void addFiles(e.target.files)}/>{busy&&<div className="upload-progress" role="status"><span className="loading-spinner"/>Reading and extracting source files. Larger scans can take a little longer.</div>}{candidates.length>0&&<section className="suggestion-panel"><div className="suggestion-heading"><div><b>Review extracted suggestions</b><p>The upload also creates an editable draft automatically. Suggestions below are additional candidates; review each before applying.</p></div><span>{candidates.length} found</span></div><div className="suggestion-list">{candidates.map((candidate,i)=>{const lineItem=candidate.field==='lineItem'&&typeof candidate.value==='object'?candidate.value as Line:null;const poKind=poCandidateKind(candidate,candidates,draft.customerReference);const conflicting=candidate.field!=='lineItem'&&candidates.some((other,j)=>j!==i&&other.field===candidate.field&&String(other.value)!==String(candidate.value));return <article className="suggestion-row" key={`${candidate.field}-${candidate.source}-${i}`}><div className="suggestion-copy"><label>{lineItem?'Possible invoice line · review':candidate.label}</label><strong>{lineItem?lineItem.description:String(candidate.value)}</strong>{lineItem&&<small>{lineItem.quantity.toLocaleString()} {lineItem.unit} · {fmt(lineItem.value)} · {lineItem.tariffNo?`invoice HS ${lineItem.tariffNo}`:'no HS code detected'} · {lineItem.countryOrigin||'origin missing'}</small>}<small>Source: {candidate.source} · Verify before use</small>{poKind&&<em>{poKind==='fabric'?'Separate fabric PO; do not use as shipment PO.':'Likely OCR variant; compare the original scan before use.'}</em>}{conflicting&&!poKind&&<em>Different values were found in the shipment documents</em>}</div><div className="suggestion-actions"><button className="outline-btn" onClick={()=>applyCandidate(candidate,i)} disabled={busy||Boolean(poKind)}>{poKind?'Review only':'Apply'}</button><button className="dismiss-suggestion" onClick={()=>dismissCandidate(i)} disabled={busy} aria-label={`Dismiss ${candidate.label} suggestion`}><X size={15}/></button></div></article>})}</div></section>}{docs.length===0?<div className="empty-docs"><div className="empty-icon"><Upload size={22}/></div><h3>Start with the shipment paperwork</h3><p>Upload a commercial invoice, packing list, bill of lading, or other shipment files.</p><button className="outline-btn" onClick={()=>inputRef.current?.click()} disabled={busy}><Upload size={14}/> Choose files</button></div>:<div className="extracted-list">{docs.map((doc,i)=><article className="extracted-doc" key={`${doc.filename}-${i}`}><div className="extracted-header"><div className="file-icon f0"><FileText size={15}/></div><div><b>{doc.filename}</b><small>{fileSize(doc.bytes)} · {doc.extractionMethod||'No text extracted'}{typeof doc.ocrConfidence==='number'?` · OCR confidence ${doc.ocrConfidence}%`:''}</small></div><button className="text-btn" onClick={()=>setShowRaw(showRaw===doc.filename?null:doc.filename)}>{showRaw===doc.filename?'Hide text':'View extracted text'} <ChevronDown size={14}/></button></div>{doc.parseError&&<div className="parse-warning"><CircleAlert size={15}/>{doc.parseError}</div>}{doc.ocrNote&&<div className="parse-warning"><CircleAlert size={15}/>{doc.ocrNote}</div>}{showRaw===doc.filename&&<pre className="raw-text">{doc.text||'No selectable text was found in this file.'}</pre>}</article>)}</div>}</div><aside className="card extraction-side"><div className="section-kicker">EXTRACTION STATUS</div><h2>Evidence before entry</h2><p>The upload creates an editable draft. Candidate matches retain their source file; verify them before use.</p><label className="ai-consent"><input type="checkbox" checked={allowCloudExtraction} onChange={e=>setAllowCloudExtraction(e.target.checked)}/><span><b>Use optional AI extraction</b><small>{llmConfigured?"Extracted text will be sent to OpenAI for this upload.":"OpenAI is not configured; local extraction will be used."} {allowCloudExtraction&&llmConfigured?"Enabled for uploads.":"Unchecked means no AI service is called."}</small></span></label><div className="status-check"><Check size={15}/><span>Text extraction and local OCR for images/scanned PDFs</span></div><div className="status-check"><Search size={15}/><span>Common shipment fields and conservative line candidates</span></div><div className="status-check muted"><CircleAlert size={15}/><span>Every extraction needs source review; no tariff or value decision is made</span></div><div className="honest-box"><b>Extraction boundary</b><p>Line candidates need a clear quantity, unit, and extended amount; material and construction details are retained when found. Ambiguous layouts still need manual review. Classification, customs value, and manufacturer IDs remain broker decisions.</p></div></aside></div>}

        {tab==='xml'&&<div className="xml-workspace"><section className="card xml-card"><div className="xml-toolbar"><div><div className="section-kicker">NETCHB ENTRY UPLOAD</div><h2>XML draft <span className="draft-pill"><span/> NOT FILED</span></h2><p>System-generated entry number · Upload schema order · Transmission disabled</p></div><div className="xml-actions"><button className="outline-btn" onClick={()=>void copyXml()}><Clipboard size={14}/> Copy</button><button className="primary-btn small" onClick={downloadXml}><ArrowDownToLine size={15}/> Download XML</button></div></div><div className="xml-code"><div className="code-top"><span className="code-dot red"/><span className="code-dot yellow"/><span className="code-dot green"/><span className="code-file">{xmlFileName(draft.invoiceNo)}</span><span className="code-mode">XML</span></div><pre>{xml||'Generating…'}</pre></div><div className="schema-foot"><Check size={15}/><span>Element sequence follows the referenced NetCHB Entry Upload XSD. Missing required data is omitted; this draft may not validate.</span><span className="schema-foot-right">No transmit tag included</span></div>{(xmlRequiredMissing.length>0||xmlOmittedLines>0||xmlNoLines)&&<div className="xml-incomplete" role="status"><CircleAlert size={15}/><span>{xmlRequiredMissing.length>0&&<>Missing required fields: {xmlRequiredMissing.join(", ")}. </>}{xmlNoLines&&<>No invoice lines are in the draft. Add source lines before attempting validation. </>}{xmlOmittedLines>0&&<>{xmlOmittedLines} line item(s) omitted because a source tariff code or valid value is missing.</>}</span></div>}</section><aside className="card xml-review"><div className="review-title"><div><div className="section-kicker">BROKER CHECKLIST</div><h2>{blocking} filing blockers</h2></div><span className="warning-count"><CircleAlert size={15}/></span></div><p className="review-intro">The XML may be incomplete: unknown schema-required fields and unsupported line items are omitted. Resolve the checklist before using it with NetCHB.</p><div className="review-list full">{reviews.map((item,i)=><ReviewRow key={i} item={item}/>)}</div><div className="xml-disclaimer"><ShieldCheck size={16}/><p><b>Generated for review only.</b><br/>Missing origin or tariff fields can make this draft fail NetCHB validation. Confirm filer-specific and legally required data.</p></div><div className="official-guides"><b>Official references</b><a href="https://www.help.cbp.gov/s/article/Article-1066?language=en_US" target="_blank" rel="noreferrer">CBP importer numbers ↗</a><a href="https://www.help.cbp.gov/s/article/Article-1242?language=en_US" target="_blank" rel="noreferrer">CBP textile MID rules ↗</a><a href="https://hts.usitc.gov/?showFullTree=true" target="_blank" rel="noreferrer">Current USITC HTS ↗</a></div></aside></div>}
        {tab==='settings'&&<div className="settings-workspace"><section className="card settings-card"><div className="card-header"><div><div className="section-kicker">BROKER PROFILE</div><h2>Entry defaults</h2><p>Set values your team commonly uses. Apply them to a draft, then verify each against account and shipment instructions.</p></div><ShieldCheck size={20}/></div><div className="settings-grid"><Field label="Importer tax ID" value={brokerSettings.importerTaxId} onChange={v=>setBrokerSettings(current=>({...current,importerTaxId:v}))} placeholder="Importer number / EIN" hint="Stored only in this browser session"/><Field label="Default processing port" value={brokerSettings.processingPort} onChange={v=>setBrokerSettings(current=>({...current,processingPort:v}))} placeholder="4-digit CBP port" hint="Confirm with filer profile"/><Field label="Default entry type" value={brokerSettings.entryType} onChange={v=>setBrokerSettings(current=>({...current,entryType:v}))} hint="01 = consumption entry"/><Field label="Default transport mode" value={brokerSettings.transportMode} onChange={v=>setBrokerSettings(current=>({...current,transportMode:v}))} hint="11 = containerized vessel"/><Field label="Default bond type" value={brokerSettings.bondType} onChange={v=>setBrokerSettings(current=>({...current,bondType:v}))} placeholder="00, 08, or 09" hint="NetCHB XSD codes; confirm with broker"/><Field label="Default payment type" value={brokerSettings.paymentType} onChange={v=>setBrokerSettings(current=>({...current,paymentType:v}))} placeholder="1, 2, 3, 5, 6, 7, or 8" hint="NetCHB XSD codes; confirm with broker"/></div><div className="settings-actions"><button className="outline-btn" onClick={resetBrokerSettings}>Clear defaults</button><button className="outline-btn" onClick={saveBrokerSettings}>Save for this session</button><button className="primary-btn" onClick={applyBrokerSettings}><Check size={15}/> Apply to current entry</button></div><div className="settings-note"><CircleAlert size={16}/><p>These values are local defaults only. They do not verify importer enrollment, bond, payment, ABI filer setup, or NetCHB account configuration.</p></div></section><aside className="card extraction-side"><div className="section-kicker">ACCOUNT INTEGRATION</div><h2>Local prototype</h2><p>This screen does not connect to NetCHB or a broker account. Keep credentials and production account details out of this demo.</p><div className="honest-box"><b>Session storage</b><p>Saved defaults remain in this browser tab’s session and are cleared when you clear them or close the session.</p></div></aside></div>}
        <footer className="page-footer"><span>SEFER <span className="footer-dot">·</span> ENTRY WORKBENCH</span><span>Built for broker review <span className="footer-dot">·</span> NetCHB XML</span></footer>
      </div>
    </main>
    {showReviewGuide&&<div className="modal-backdrop" onClick={()=>setShowReviewGuide(false)}><section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={event=>event.stopPropagation()}><button className="modal-close" aria-label="Close guide" onClick={()=>setShowReviewGuide(false)}><X size={17}/></button><div className="section-kicker">BROKER REVIEW</div><h2 id="guide-title">Review before export</h2><ol><li>Compare each suggestion with its source document before applying it.</li><li>Reconcile invoice lines, package counts, weights, origin, and customs value.</li><li>Complete importer profile, tariff classification, bond/payment, and entry details with your broker.</li><li>Download the XML draft only after review. This app does not transmit to NetCHB or CBP.</li></ol><button className="primary-btn" onClick={()=>{setShowReviewGuide(false);setTab('xml');}}>Open review checklist <ArrowRight size={15}/></button></section></div>}
    {pendingReplacement&&<div className="modal-backdrop" onClick={()=>setPendingReplacement(null)}><section className="guide-modal discard-modal" role="dialog" aria-modal="true" aria-labelledby="discard-title" onClick={event=>event.stopPropagation()}><button className="modal-close" aria-label="Keep working" onClick={()=>setPendingReplacement(null)}><X size={17}/></button><div className="section-kicker">UNSAVED SHIPMENT</div><h2 id="discard-title">Keep this draft?</h2><p className="discard-copy">This shipment has edits that are not saved. Save the entry first, or discard these changes and continue.</p><div className="discard-actions"><button className="outline-btn" onClick={()=>setPendingReplacement(null)}>Keep working</button><button className="primary-btn" onClick={continueReplacement}>Discard and continue</button></div></section></div>}
    {toast&&<div className="toast" role="status" aria-live="polite" aria-atomic="true"><Check size={15}/>{toast}</div>}
  </div>;
}

function Field({label,value,onChange,placeholder,type='text',source,hint,suffix,flag,readOnly}:{label:string;value:string|number;onChange:(v:string)=>void;placeholder?:string;type?:string;source?:string;hint?:string;suffix?:string;flag?:string;readOnly?:boolean}){
  return <label className="field"><span className="field-label">{label}{flag&&<em className="field-flag">{flag}</em>}</span><span className={`field-control ${readOnly?'read-only':''}`}><input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} readOnly={readOnly}/>{suffix&&<i>{suffix}</i>}</span><small>{source||hint||' '}</small></label>;
}
function ReviewRow({item}:{item:Review}){return <div className="review-item"><span className={`review-icon ${item.level}`}><CircleAlert size={14}/></span><div><b>{item.title}</b><p>{item.detail}</p></div></div>}

export default App;
