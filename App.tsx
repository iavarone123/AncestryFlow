
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { extractFamilyData, discoverExtendedFamily, updateFamilyData, researchDeathRecords, askGemini, mergeChatInfo } from './services/geminiService';
import { ExtractionResult, FamilyMember, GroundingSource } from './types';
import TreeVisualization from './components/TreeVisualization';

const App: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [updateText, setUpdateText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<'analyzing' | 'researching' | 'previewing' | 'updating' | 'chatting' | 'merging' | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'tree' | 'list'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Chat State
  const [chatQuery, setChatQuery] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string, id: string, sources?: GroundingSource[]}[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [previewImageData, setPreviewImageData] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isChatOpen]);

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuery.trim()) return;

    const userMessage = chatQuery.trim();
    setChatQuery('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMessage, id: Date.now().toString() }]);
    setIsChatOpen(true);
    setProcessingStatus('chatting');

    try {
      const response = await askGemini(userMessage, extractionResult);
      setChatHistory(prev => [...prev, { role: 'ai', text: response.text, id: (Date.now() + 1).toString(), sources: response.sources }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'ai', text: "I encountered a connection error. Please try asking again.", id: (Date.now() + 1).toString() }]);
    } finally {
      setProcessingStatus(null);
    }
  };

  const handleMergeChatResult = async (chatId: string, chatText: string) => {
    setIsProcessing(true);
    setProcessingStatus('merging');
    const chatIndex = chatHistory.findIndex(c => c.id === chatId);
    const userQuery = chatIndex > 0 ? chatHistory[chatIndex - 1].text : "Merge request";
    try {
      const merged = await mergeChatInfo(extractionResult, chatText, userQuery);
      setExtractionResult(merged);
      setActiveTab('tree');
    } catch (e) {
      setError("Failed to integrate information into the tree.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const processLineage = useCallback(async (initialResult: ExtractionResult, direction: 'forward' | 'backward', originalName: string) => {
    setProcessingStatus('researching');
    try {
      if (!initialResult.members || initialResult.members.length === 0) {
        setExtractionResult(initialResult);
        setActiveTab('tree');
        return;
      }
      const expandedResult = await discoverExtendedFamily(initialResult.members, direction);
      const finalResult: ExtractionResult = {
        ...expandedResult,
        title: expandedResult.title || initialResult.title || `${originalName} Lineage`,
        description: expandedResult.description || initialResult.description || "Historical records mining result",
        sources: [...(initialResult.sources || []), ...(expandedResult.sources || [])]
      };
      setExtractionResult(finalResult);
      setActiveTab('tree');
    } catch (err: any) {
      setExtractionResult(initialResult);
      setActiveTab('tree');
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  }, []);

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
        sources: [...(prev?.sources || []), ...(expandedResult.sources || [])]
      }));
      setActiveTab('tree');
    } catch (err: any) {
      setError("No deeper ancestors were found in public archives for this profile.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const handleInitialSearch = async (direction: 'forward' | 'backward') => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    setProcessingStatus('analyzing');
    setError(null);
    const searchName = inputText.trim();
    try {
      const result = await extractFamilyData(searchName, 'text');
      if (!result.members || result.members.length === 0) {
        setError(`We couldn't find verifiable historical records for "${searchName}". Please check the spelling or provide a birth year/location.`);
        setIsProcessing(false);
        setProcessingStatus(null);
        return;
      }
      await processLineage(result, direction, searchName);
    } catch (err: any) {
      setError('Search timed out. This can happen for very common names. Try adding more detail like "John Smith 1920 London".');
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const handleDeathSearch = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    setProcessingStatus('researching');
    setError(null);
    try {
      const result = await researchDeathRecords(inputText);
      if (!result.members || result.members.length === 0) {
        setError("Vital death records search returned no definitive matches. Ensure the person is deceased and spellings are correct.");
        setIsProcessing(false);
        setProcessingStatus(null);
        return;
      }
      setExtractionResult(result);
      setActiveTab('tree');
    } catch (err: any) {
      setError('Record search failed. Our archive connection might be experiencing high traffic.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const handleUpdateSubmit = async () => {
    if (!updateText.trim() || !extractionResult) return;
    setIsProcessing(true);
    setProcessingStatus('updating');
    setError(null);
    try {
      const result = await updateFamilyData(extractionResult, updateText);
      setExtractionResult(result);
      setShowUpdateModal(false);
      setUpdateText('');
    } catch (err: any) {
      setError('Failed to update the tree structure.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const generatePDFPreview = async () => {
    const targetId = activeTab === 'tree' ? 'tree-capture-area' : 'list-capture-area';
    const element = document.getElementById(targetId);
    if (!element) return;
    setIsProcessing(true);
    setProcessingStatus('previewing');
    try {
      const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      setPreviewImageData(canvas.toDataURL('image/png'));
      setShowPreview(true);
    } catch (err) {
      setError("High-resolution record capture failed.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const finalizeDownload = async () => {
    if (!previewImageData) return;
    setIsExporting(true);
    try {
      const pdf = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      pdf.addImage(previewImageData, 'PNG', 20, 20, pw - 40, ph - 40);
      pdf.save(`${extractionResult?.title?.replace(/\s+/g, '-') || 'ancestry-lineage'}.pdf`);
      setShowPreview(false);
    } catch (e) {
      setError("Export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setProcessingStatus('analyzing');
    setError(null);
    try {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const result = await extractFamilyData(e.target?.result as string, 'image', file.type);
            await processLineage(result, 'forward', file.name);
          } catch (err) {
            setError("We couldn't extract lineage from this file. Ensure it contains clear names and relationships.");
            setIsProcessing(false);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const result = await extractFamilyData(e.target?.result as string, 'text');
            await processLineage(result, 'forward', "Subject");
          } catch (err) {
            setError("Document analysis failed.");
            setIsProcessing(false);
          }
        };
        reader.readAsText(file);
      }
    } catch (err) {
      setIsProcessing(false);
    }
  }, [processLineage]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-24">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30 shadow-sm print:hidden">
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
          <button onClick={() => setActiveTab('upload')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'upload' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Search</button>
          <button onClick={() => extractionResult && setActiveTab('tree')} disabled={!extractionResult} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'tree' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'} disabled:opacity-30`}>Tree</button>
          <button onClick={() => extractionResult && setActiveTab('list')} disabled={!extractionResult} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'} disabled:opacity-30`}>List</button>
        </nav>
        <button onClick={() => { if (window.confirm("Start over?")) { setExtractionResult(null); setInputText(''); setActiveTab('upload'); setChatHistory([]); } }} className="text-slate-300 hover:text-rose-500 p-2"><i className="fas fa-redo-alt"></i></button>
      </header>

      <main className={`flex-1 p-6 ${activeTab === 'upload' ? 'max-w-7xl mx-auto' : 'w-full'} flex flex-col`}>
        {activeTab === 'upload' ? (
          <div className="grid lg:grid-cols-5 gap-8">
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
                <h2 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3">
                  <i className="fas fa-search text-indigo-600"></i> Global Research
                </h2>
                <textarea 
                  className="w-full h-48 p-6 bg-slate-50 border border-slate-200 rounded-3xl focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all text-slate-700 text-lg"
                  placeholder="Enter a subject name, birth year, or story to trace lineage."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <button onClick={() => handleInitialSearch('forward')} disabled={isProcessing || !inputText.trim()} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-5 rounded-3xl shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    <i className="fas fa-arrow-down"></i> Trace Heirs
                  </button>
                  <button onClick={() => handleInitialSearch('backward')} disabled={isProcessing || !inputText.trim()} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-5 rounded-3xl shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    <i className="fas fa-arrow-up"></i> Trace Ancestors
                  </button>
                  <button onClick={handleDeathSearch} disabled={isProcessing || !inputText.trim()} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-black py-5 rounded-3xl shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    <i className="fas fa-book-dead"></i> Vital Records
                  </button>
                </div>
              </div>
              <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
                <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                  <i className="fas fa-file-upload text-indigo-600"></i> Document Analysis
                </h2>
                <label 
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) processFile(file); }}
                  className={`flex flex-col items-center justify-center w-full h-44 border-2 border-dashed rounded-3xl cursor-pointer transition-all ${isDragging ? 'bg-indigo-50 border-indigo-500' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                >
                  <i className="fas fa-cloud-arrow-up text-3xl mb-4 text-slate-300"></i>
                  <p className="text-sm text-slate-600 font-bold">Drop PDF or Document Image</p>
                  <input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => { const file = e.target.files?.[0]; if (file) processFile(file); }} />
                </label>
              </div>
            </div>
            <div className="lg:col-span-2 bg-indigo-600 rounded-[4rem] p-12 text-white flex flex-col justify-center shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-12 opacity-10 rotate-12"><i className="fas fa-dna text-[12rem]"></i></div>
              <h3 className="text-4xl font-black mb-8">Lineage Intelligence</h3>
              <p className="text-indigo-100 text-xl leading-relaxed mb-12">
                Trace complex family connections backward or forward using grounded AI research across global historical archives.
              </p>
              {error && <div className="p-5 bg-rose-500 text-white rounded-2xl text-sm font-black animate-in slide-in-from-top">{error}</div>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-4xl font-black text-slate-900 tracking-tighter mb-2">{extractionResult?.title || "Lineage Archive"}</h2>
                <p className="text-lg text-slate-500 font-medium">{extractionResult?.description || "Visual record analysis"}</p>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setShowUpdateModal(true)} className="px-8 py-4 bg-indigo-50 text-indigo-700 rounded-2xl text-sm font-black hover:bg-indigo-100 transition-all flex items-center gap-3"><i className="fas fa-edit"></i> Edit Records</button>
                <button onClick={generatePDFPreview} disabled={isProcessing} className="px-8 py-4 bg-white border border-slate-200 rounded-2xl text-sm font-black hover:bg-slate-50 transition-all flex items-center gap-3"><i className="fas fa-file-pdf text-rose-500"></i> Export PDF</button>
              </div>
            </div>
            <div id="tree-capture-area" className="w-full">
               {activeTab === 'tree' && extractionResult && <TreeVisualization members={extractionResult.members} onResearchAncestors={handleResearchAncestors} />}
               {activeTab === 'list' && (
                 <div id="list-capture-area" className="bg-white rounded-[3rem] p-12 border border-slate-100 shadow-sm grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {extractionResult?.members.map(m => (
                      <div key={m.id} className="p-8 rounded-[2rem] border-2 border-slate-50 bg-slate-50/50">
                        <h4 className="text-xl font-black text-slate-800 mb-2">{m.name}</h4>
                        <p className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-4">{m.relationship || 'Member'}</p>
                        <p className="text-sm font-medium text-slate-500">{m.birthYear || '????'} — {m.deathYear || 'Now'}</p>
                      </div>
                    ))}
                 </div>
               )}
            </div>
          </div>
        )}
      </main>

      {/* Persistent Chat Bar */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-6 z-50">
        {isChatOpen && chatHistory.length > 0 && (
          <div className="mb-4 bg-white/95 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-indigo-50 p-8 max-h-[50vh] overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom">
            <div className="space-y-6">
              {chatHistory.map((chat) => (
                <div key={chat.id} className={`flex flex-col ${chat.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] p-5 rounded-3xl text-sm font-medium ${chat.role === 'user' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-700'}`}>{chat.text}</div>
                  {chat.role === 'ai' && chat.text.length > 20 && (
                    <button onClick={() => handleMergeChatResult(chat.id, chat.text)} className="mt-2 text-[10px] font-black bg-indigo-600 text-white px-4 py-2 rounded-full hover:bg-indigo-700 transition-all flex items-center gap-2"><i className="fas fa-plus-circle"></i> Update Tree with Info</button>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>
        )}
        <form onSubmit={handleChatSubmit} className="relative flex items-center">
          <input type="text" className="w-full h-16 pl-14 pr-24 bg-white border-2 border-indigo-50 rounded-full shadow-2xl outline-none focus:border-indigo-500 text-slate-700 font-bold" placeholder="Ask AI about relatives or record links..." value={chatQuery} onChange={(e) => setChatQuery(e.target.value)} />
          <div className="absolute left-6 text-indigo-500"><i className="fas fa-sparkles"></i></div>
          <button type="submit" className="absolute right-2 h-12 px-6 bg-indigo-600 text-white rounded-full font-black text-xs uppercase tracking-widest disabled:opacity-50" disabled={!chatQuery.trim() || processingStatus === 'chatting'}>Ask AI</button>
        </form>
      </div>

      {isProcessing && !showPreview && processingStatus !== 'chatting' && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur z-[100] flex items-center justify-center p-6">
          <div className="bg-white p-20 rounded-[4rem] text-center max-w-lg w-full">
            <div className="w-24 h-24 border-8 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-10"></div>
            <h3 className="text-3xl font-black text-slate-900 mb-4">{processingStatus === 'analyzing' ? 'Analyzing Archive' : 'Mining Records'}</h3>
            <p className="text-slate-500 font-medium">Gemini is searching global historical databases. This may take a moment...</p>
          </div>
        </div>
      )}

      {showUpdateModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur z-[100] flex items-center justify-center p-6">
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl max-w-2xl w-full">
            <h3 className="text-3xl font-black text-slate-900 mb-8">Refine Information</h3>
            <textarea className="w-full h-48 p-6 bg-slate-50 border border-slate-200 rounded-3xl outline-none text-lg mb-8" placeholder="Add missing names, correct dates, or provide more context..." value={updateText} onChange={(e) => setUpdateText(e.target.value)} />
            <div className="flex gap-4">
              <button onClick={() => setShowUpdateModal(false)} className="flex-1 py-4 font-black text-slate-500">Cancel</button>
              <button onClick={handleUpdateSubmit} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-xl">Apply Changes</button>
            </div>
          </div>
        </div>
      )}

      {showPreview && previewImageData && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur z-[100] flex items-center justify-center p-10">
          <div className="bg-white rounded-[4rem] max-w-7xl w-full max-h-full flex flex-col overflow-hidden">
            <div className="px-12 py-10 flex justify-between items-center border-b border-slate-100">
              <h3 className="text-3xl font-black">Export Preview</h3>
              <button onClick={() => setShowPreview(false)} className="text-slate-400 text-3xl"><i className="fas fa-times"></i></button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-12 flex items-center justify-center">
              <img src={previewImageData} className="max-w-full h-auto shadow-2xl rounded" alt="Preview" />
            </div>
            <div className="px-12 py-10 flex justify-end gap-6 bg-white border-t border-slate-100">
              <button onClick={() => setShowPreview(false)} className="px-10 py-4 font-black text-slate-500">Cancel</button>
              <button onClick={finalizeDownload} disabled={isExporting} className="px-16 py-4 bg-indigo-600 text-white rounded-3xl font-black shadow-2xl disabled:opacity-50">
                {isExporting ? 'Generating PDF...' : 'Download PDF Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
