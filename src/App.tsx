import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
type Row = Record<string, unknown>;
export default function App() {
  const [rows,setRows]=useState<Row[]>([]);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    async function load() {
      const all:Row[]=[];
      for(let offset=0;;offset+=500) {
        const {data,error}=await supabase.from('gtd_projects').select('*').order('id').range(offset,offset+499);
        if(error) throw error;
        all.push(...(data??[]));
        if((data?.length??0)<500) break;
      }
      if(active) setRows(all);
    }
    load().catch(()=>{if(active)setError('Unable to load the archive. Please try again.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const visible=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5"><h1 className="text-2xl font-bold">GTD read-only archive</h1><p className="mt-2">This tracker has moved to Executive OS. Historical records remain available here for validation. Make all new changes in Executive OS.</p><a className="mt-3 inline-block rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white" href="https://executive.compassmarketing.ai/projects">Open Executive OS</a></header>
      <label className="mb-4 block">Search preserved records<input value={query} onChange={e=>setQuery(e.target.value)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-900 p-3" /></label>
      {loading && <p>Loading archive…</p>}{error && <p role="alert">{error}</p>}
      <p className="mb-4 text-sm text-slate-400">{visible.length} of {rows.length} preserved projects. Editing and calendar synchronization are disabled.</p>
      <div className="space-y-3">{visible.map(row=><details key={String(row.id)} className="rounded-lg border border-slate-700 bg-slate-900 p-4"><summary className="cursor-pointer"><strong>{String(row['Project Name']??'Untitled')}</strong><span className="ml-3 text-sm text-slate-400">{String(row.Status??'Legacy status missing')} · {String(row.Department??'')}</span></summary><dl className="mt-4 space-y-3">{Object.entries(row).map(([key,value])=><div key={key}><dt className="text-xs text-slate-400">{key}</dt><dd className="whitespace-pre-wrap break-words text-sm">{value===null?'Not recorded':String(value)}</dd></div>)}</dl></details>)}</div>
    </div>
  </main>;
}
