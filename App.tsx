
import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { extractFamilyData, discoverExtendedFamily } from './services/geminiService';
import { ExtractionResult, FamilyMember } from './types';
import TreeVisualization from './components/TreeVisualization';

const App: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<'analyzing' | 'researching' | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'tree'>('upload');
  const [isDragging, setIsDragging] = useState(false);

  /**
   * Automated Step: Extraction + Forward research ONLY.
   */
  const processAndResearch = async (initialResult: ExtractionResult) => {
    setProcessingStatus('researching');
    try {
      // Automatic step is strictly FORWARD (Descendants/Contemporaries)
      const expandedResult = await discoverExtendedFamily(initialResult.members, 'forward');
      const finalResult: ExtractionResult = {
        ...expandedResult,
        title: expandedResult.title || initialResult.title || "Family Lineage",
        description: expandedResult.description || initialResult.description || "AI-powered genealogy",
        sources: [...(initialResult.sources || []), ...(expandedResult.sources || [])]
      };
      setExtractionResult(finalResult);
      setActiveTab('tree');
    } catch (err: any) {
      console.warn("Automated research failed, using extracted data only.", err);
      setExtractionResult(initialResult);
      setActiveTab('tree');
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  /**
   * Manual Request: BACKWARD search for ancestors.
   */
  const handleResearchAncestors = async (memberId?: string) => {
    if (!extractionResult?.members.length) return;
    setIsProcessing(true);
    setProcessingStatus('researching');
    setError(null);
    try {
      const expandedResult = await discoverExtendedFamily(extractionResult.members, 'backward', memberId);
      setExtractionResult(prev => ({
        ...expandedResult,
        title: prev?.title || expandedResult.title,
        description: prev?.description || expandedResult.description,
        sources: [...(prev?.sources || []), ...(expandedResult.sources || [])]
      }));
    } catch (err: any) {
      setError("Ancestor lookup failed. Records might be restricted or unavailable.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const handleDownloadPDF = async () => {
    const element = document.getElementById('tree-capture-area');
    if (!element) return;
    
    setIsExporting(true);
    try {
      const canvas = await html2canvas(element, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
      const finalWidth = canvas.width * ratio;
      const finalHeight = canvas.height * ratio;
      
      pdf.addImage(imgData, 'PNG', (pdfWidth - finalWidth) / 2, (pdfHeight - finalHeight) / 2, finalWidth, finalHeight);
      pdf.save(`${extractionResult?.title?.replace(/\s+/g, '-') || 'family-tree'}.pdf`);
    } catch (err) {
      setError("PDF Generation failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setProcessingStatus('analyzing');
    setError(null);
    const fileName = file.name.toLowerCase();
    const isSpreadsheet = fileName.endsWith('.csv') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    const isImage = file.type.startsWith('image/') || fileName.endsWith('.pdf');

    try {
      if (isSpreadsheet) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const data = new Uint8Array(event.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const csvData = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
            const result = await extractFamilyData(csvData, 'spreadsheet');
            await processAndResearch(result);
          } catch (err: any) {
            setError('Spreadsheet parsing failed.');
            setIsProcessing(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (isImage) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const result = await extractFamilyData(event.target?.result as string, 'image', file.type || 'application/pdf');
            await processAndResearch(result);
          } catch (err: any) {
            setError('File processing failed.');
            setIsProcessing(false);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const result = await extractFamilyData(event.target?.result as string, 'text');
            await processAndResearch(result);
          } catch (err: any) {
            setError('Text analysis failed.');
            setIsProcessing(false);
          }
        };
        reader.readAsText(file);
      }
    } catch (err) {
      setError('Unexpected error occurred.');
      setIsProcessing(false);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleTextSubmit = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    setProcessingStatus('analyzing');
    try {
      const result = await extractFamilyData(inputText, 'text');
      await processAndResearch(result);
    } catch (err: any) {
      setError('Failed to extract data.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <i className="fas fa-sitemap text-white text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">AncestryFlow</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">AI Genealogy Engine</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button onClick={() => setActiveTab('upload')} className={`px-6 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'upload' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Input</button>
          <button onClick={() => extractionResult && setActiveTab('tree')} disabled={!extractionResult} className={`px-6 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'tree' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'} ${!extractionResult ? 'opacity-50' : ''}`}>Tree View</button>
        </nav>

        <button onClick={() => { if (window.confirm("New project?")) { setExtractionResult(null); setInputText(''); setActiveTab('upload'); } }} className="text-slate-300 hover:text-rose-500 p-2"><i className="fas fa-redo-alt"></i></button>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col">
        {activeTab === 'upload' ? (
          <div className="grid lg:grid-cols-5 gap-8 h-full">
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                  <i className="fas fa-feather-pointed text-indigo-600"></i> Family Details
                </h2>
                <textarea 
                  className="w-full h-56 p-5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-50 outline-none transition-all text-slate-700 text-sm leading-relaxed"
                  placeholder="Paste details about your family history here. Mention names, birth years, and relationships. Gemini will research the future generations automatically."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button onClick={handleTextSubmit} disabled={isProcessing || !inputText.trim()} className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-xl shadow-indigo-100 disabled:opacity-50">
                  {isProcessing ? 'Processing...' : 'Generate Family Tree'}
                </button>
              </div>

              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                  <i className="fas fa-file-upload text-indigo-600"></i> Direct Import
                </h2>
                <label 
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex flex-col items-center justify-center w-full h-44 border-2 border-dashed rounded-2xl cursor-pointer transition-all relative overflow-hidden group ${isDragging ? 'bg-indigo-50 border-indigo-500 scale-[1.01]' : 'bg-white border-slate-200 hover:bg-slate-50/50 hover:border-indigo-300'}`}
                >
                  <div className={`flex flex-col items-center justify-center transition-all ${isDragging ? 'pointer-events-none' : ''}`}>
                    <i className={`fas fa-cloud-arrow-up text-3xl mb-4 transition-colors ${isDragging ? 'text-indigo-500' : 'text-slate-300 group-hover:text-indigo-400'}`}></i>
                    <p className="text-sm text-slate-600 font-bold">Drop records here or browse</p>
                    <p className="text-[11px] text-slate-400 font-medium">PDFs, Images, and Spreadsheets</p>
                  </div>
                  <input type="file" className="hidden" accept="image/*,application/pdf,.csv,.xlsx,.xls,.txt" onChange={handleFileChange} disabled={isProcessing} />
                </label>
              </div>
            </div>

            <div className="lg:col-span-2 bg-indigo-600 rounded-3xl p-10 text-white flex flex-col justify-center shadow-2xl">
              <h3 className="text-3xl font-bold mb-6">Forward Growth</h3>
              <p className="text-indigo-100/80 leading-relaxed mb-10 text-lg">
                By default, we build your tree and research descendants (children/grandchildren). 
                Want to go back in time? Click the <b>Search Ancestors</b> button on any member in the tree view.
              </p>
              <div className="space-y-4">
                <div className="flex items-center gap-4 bg-white/10 p-4 rounded-2xl border border-white/10">
                  <div className="w-8 h-8 bg-green-400/20 text-green-300 rounded-full flex items-center justify-center flex-shrink-0"><i className="fas fa-arrow-down"></i></div>
                  <div><p className="text-xs font-bold uppercase text-indigo-200">Default Mode</p><p className="font-semibold">Forward Research</p></div>
                </div>
                <div className="flex items-center gap-4 bg-white/10 p-4 rounded-2xl border border-white/10 opacity-60">
                  <div className="w-8 h-8 bg-amber-400/20 text-amber-300 rounded-full flex items-center justify-center flex-shrink-0"><i className="fas fa-arrow-up"></i></div>
                  <div><p className="text-xs font-bold uppercase text-indigo-200">Manual Selection</p><p className="font-semibold">Discover Ancestors</p></div>
                </div>
              </div>
              {error && <div className="mt-8 p-4 bg-rose-500/20 border border-rose-500/30 text-rose-100 rounded-xl text-xs font-bold">{error}</div>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-[calc(100vh-140px)]">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold text-slate-800 mb-1">{extractionResult?.title}</h2>
                <p className="text-sm text-slate-500">{extractionResult?.description}</p>
                {extractionResult?.sources && extractionResult.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {extractionResult.sources.slice(0, 4).map((s, i) => (
                      <a key={i} href={s.uri} target="_blank" className="text-[10px] bg-white text-slate-600 px-3 py-1 rounded-full border border-slate-200 font-bold shadow-sm">{s.title}</a>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={handleDownloadPDF} disabled={isExporting} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2">
                  <i className={`fas ${isExporting ? 'fa-circle-notch animate-spin' : 'fa-file-pdf text-rose-500'}`}></i> PDF
                </button>
                <button onClick={() => handleResearchAncestors()} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2">
                  <i className="fas fa-history text-amber-500"></i> Discovery Mode: Ancestors
                </button>
                <button onClick={() => setActiveTab('upload')} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-xl">Add Records</button>
              </div>
            </div>
            
            <div className="flex-1 min-h-0 bg-white rounded-[2.5rem] shadow-inner border border-slate-200 relative overflow-hidden">
               {extractionResult && (
                 <TreeVisualization members={extractionResult.members} onResearchAncestors={handleResearchAncestors} />
               )}
            </div>
          </div>
        )}
      </main>

      {(isProcessing || isExporting) && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-lg z-50 flex items-center justify-center">
              <div className="bg-white p-14 rounded-[3rem] shadow-2xl max-w-md w-full text-center border border-indigo-50">
                  <div className="relative w-28 h-28 mx-auto mb-10">
                    <div className="absolute inset-0 border-[6px] border-indigo-50 rounded-full"></div>
                    <div className="absolute inset-0 border-[6px] border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center"><i className={`fas ${isExporting ? 'fa-file-export' : 'fa-dna'} text-indigo-600 text-4xl`}></i></div>
                  </div>
                  <h3 className="text-2xl font-black text-slate-800 mb-4">{isExporting ? 'Generating PDF' : (processingStatus === 'researching' ? 'Searching Archives' : 'Processing Records')}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-6">
                    {isExporting ? 'Preparing high-resolution tree export.' : 'Gemini is scanning historical records and cross-referencing archives.'}
                  </p>
                  {!isExporting && <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div className="h-full bg-indigo-600 transition-all duration-[30s] w-[90%]"></div></div>}
              </div>
          </div>
      )}
    </div>
  );
};

export default App;
