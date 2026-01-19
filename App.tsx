
import React, { useState, useCallback, useMemo } from 'react';
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
  const [processingStatus, setProcessingStatus] = useState<'analyzing' | 'researching' | 'previewing' | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'tree' | 'list'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Preview State
  const [previewImageData, setPreviewImageData] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  /**
   * Automated Step: Extraction + Forward research ONLY.
   */
  const processAndResearch = async (initialResult: ExtractionResult) => {
    setProcessingStatus('researching');
    try {
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

  const generatePDFPreview = async () => {
    // If user is in list view, capture the list, otherwise capture the tree
    const targetId = activeTab === 'tree' ? 'tree-capture-area' : 'list-capture-area';
    const element = document.getElementById(targetId);
    if (!element) return;
    
    setIsProcessing(true);
    setProcessingStatus('previewing');
    try {
      // For the tree, we want to capture the whole thing. For the list, just the visible part is fine or scroll area.
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        // If it's the tree, ensure we capture the whole SVG/HTML layer
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight
      });
      const imgData = canvas.toDataURL('image/png');
      setPreviewImageData(imgData);
      setShowPreview(true);
    } catch (err) {
      setError("Failed to generate preview.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const finalizeDownload = async () => {
    if (!previewImageData) return;
    
    setIsExporting(true);
    try {
      // Load image to get actual dimensions
      const img = new Image();
      img.src = previewImageData;
      await new Promise(resolve => img.onload = resolve);
      
      // Dynamic page size based on the screenshot to avoid any clipping
      const pdf = new jsPDF({
        orientation: img.width > img.height ? 'l' : 'p',
        unit: 'px',
        format: [img.width, img.height]
      });
      
      pdf.addImage(previewImageData, 'PNG', 0, 0, img.width, img.height);
      pdf.save(`${extractionResult?.title?.replace(/\s+/g, '-') || 'family-tree'}.pdf`);
      setShowPreview(false);
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

  const filteredMembers = useMemo(() => {
    if (!extractionResult) return [];
    if (!searchTerm) return extractionResult.members;
    const lower = searchTerm.toLowerCase();
    return extractionResult.members.filter(m => 
      m.name.toLowerCase().includes(lower) || 
      m.relationship?.toLowerCase().includes(lower) ||
      m.notes?.toLowerCase().includes(lower)
    );
  }, [extractionResult, searchTerm]);

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
          <button onClick={() => setActiveTab('upload')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'upload' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Input</button>
          <button onClick={() => extractionResult && setActiveTab('tree')} disabled={!extractionResult} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'tree' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'} ${!extractionResult ? 'opacity-50' : ''}`}>Tree View</button>
          <button onClick={() => extractionResult && setActiveTab('list')} disabled={!extractionResult} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'} ${!extractionResult ? 'opacity-50' : ''}`}>List View</button>
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
                <button onClick={generatePDFPreview} disabled={isProcessing} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2">
                  <i className={`fas ${isProcessing && processingStatus === 'previewing' ? 'fa-circle-notch animate-spin' : 'fa-file-pdf text-rose-500'}`}></i> Download PDF
                </button>
                <button onClick={() => handleResearchAncestors()} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2">
                  <i className="fas fa-history text-amber-500"></i> Discovery Mode: Ancestors
                </button>
                <button onClick={() => setActiveTab('upload')} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-xl">Add Records</button>
              </div>
            </div>
            
            <div className="flex-1 min-h-0 relative flex flex-col">
               {activeTab === 'tree' ? (
                 <div className="flex-1 bg-white rounded-[2.5rem] shadow-inner border border-slate-200 relative overflow-hidden">
                    {extractionResult && (
                      <TreeVisualization members={extractionResult.members} onResearchAncestors={handleResearchAncestors} />
                    )}
                 </div>
               ) : (
                 <div className="flex-1 bg-white rounded-[2.5rem] shadow-inner border border-slate-200 overflow-hidden flex flex-col">
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white/50 backdrop-blur-sm sticky top-0 z-10">
                      <div className="relative max-w-md w-full">
                        <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input 
                          type="text" 
                          placeholder="Search family members..." 
                          className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                      </div>
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        Showing {filteredMembers.length} of {extractionResult?.members.length} members
                      </div>
                    </div>
                    
                    <div id="list-capture-area" className="flex-1 overflow-auto p-6 custom-scrollbar bg-white">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredMembers.map((member) => (
                          <div key={member.id} className={`p-6 rounded-2xl border-2 transition-all hover:shadow-lg hover:-translate-y-1 ${member.gender === 'male' ? 'bg-blue-50/30 border-blue-100' : member.gender === 'female' ? 'bg-rose-50/30 border-rose-100' : 'bg-slate-50/30 border-slate-100'}`}>
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-indigo-500/80 block mb-1">
                                  {member.relationship || 'Relative'}
                                </span>
                                <h3 className="text-lg font-bold text-slate-800">{member.name}</h3>
                              </div>
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm ${member.gender === 'male' ? 'bg-blue-100 text-blue-600' : member.gender === 'female' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
                                <i className={`fas ${member.gender === 'male' ? 'fa-mars' : member.gender === 'female' ? 'fa-venus' : 'fa-user'}`}></i>
                              </div>
                            </div>
                            
                            <div className="flex gap-4 mb-4">
                              <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl flex-1 border border-slate-100 shadow-sm">
                                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-0.5">Lifespan</label>
                                <p className="text-xs font-bold text-slate-700">{member.birthYear || '????'} — {member.deathYear || 'Now'}</p>
                              </div>
                              <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl flex-1 border border-slate-100 shadow-sm">
                                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-0.5">Status</label>
                                <p className={`text-xs font-bold uppercase ${member.vitalStatus === 'living' ? 'text-emerald-600' : 'text-slate-500'}`}>
                                  {member.vitalStatus || 'Unknown'}
                                </p>
                              </div>
                            </div>

                            {member.notes && (
                              <div className="bg-white/50 p-4 rounded-xl border border-white/20 text-xs text-slate-600 leading-relaxed italic">
                                {member.notes}
                              </div>
                            )}

                            <div className="mt-4 flex gap-2">
                               <button 
                                onClick={() => handleResearchAncestors(member.id)}
                                className="flex-1 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
                               >
                                 <i className="fas fa-history"></i> Research Ancestors
                               </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                 </div>
               )}
            </div>
          </div>
        )}
      </main>

      {/* Main Processing Modal */}
      {isProcessing && !showPreview && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-lg z-50 flex items-center justify-center p-6">
              <div className="bg-white p-14 rounded-[3rem] shadow-2xl max-w-md w-full text-center border border-indigo-50">
                  <div className="relative w-28 h-28 mx-auto mb-10">
                    <div className="absolute inset-0 border-[6px] border-indigo-50 rounded-full"></div>
                    <div className="absolute inset-0 border-[6px] border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center"><i className={`fas ${processingStatus === 'previewing' ? 'fa-eye' : 'fa-dna'} text-indigo-600 text-4xl`}></i></div>
                  </div>
                  <h3 className="text-2xl font-black text-slate-800 mb-4">
                    {processingStatus === 'previewing' ? 'Preparing Preview' : (processingStatus === 'researching' ? 'Searching Archives' : 'Processing Records')}
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-6">
                    {processingStatus === 'previewing' ? 'Generating a high-quality visualization of your tree.' : 'Gemini is scanning historical records and cross-referencing archives.'}
                  </p>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className={`h-full bg-indigo-600 transition-all duration-[20s] ${processingStatus === 'previewing' ? 'w-[100%]' : 'w-[90%]'}`}></div>
                  </div>
              </div>
          </div>
      )}

      {/* PDF Preview Modal */}
      {showPreview && previewImageData && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl z-[60] flex items-center justify-center p-4 md:p-10">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-5xl w-full max-h-full flex flex-col overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-800">Export Preview</h3>
                <p className="text-xs text-slate-400 font-medium">Verify your chart layout before saving to PDF</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
                <i className="fas fa-times"></i>
              </button>
            </div>
            
            <div className="flex-1 overflow-auto bg-slate-100 p-8 flex items-center justify-center">
              <div className="bg-white shadow-lg p-2 rounded-sm border border-slate-200 max-w-full">
                <img src={previewImageData} alt="PDF Preview" className="max-w-full h-auto" />
              </div>
            </div>
            
            <div className="px-8 py-6 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <div className="flex items-center gap-2"><i className="fas fa-check-circle text-emerald-500"></i> High-Resolution Render</div>
                <div className="flex items-center gap-2"><i className="fas fa-check-circle text-emerald-500"></i> Full View Capture</div>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowPreview(false)} 
                  className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-200/50 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={finalizeDownload}
                  disabled={isExporting}
                  className="px-8 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {isExporting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-download"></i>}
                  {isExporting ? 'Generating PDF...' : 'Confirm & Download'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
