
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
      setChatHistory(prev => [...prev, { role: 'ai', text: "I'm sorry, I couldn't process that question.", id: (Date.now() + 1).toString() }]);
    } finally {
      setProcessingStatus(null);
    }
  };

  const handleMergeChatResult = async (chatId: string, chatText: string) => {
    setIsProcessing(true);
    setProcessingStatus('merging');
    
    // Find the original user query that preceded this AI response
    const chatIndex = chatHistory.findIndex(c => c.id === chatId);
    const userQuery = chatIndex > 0 ? chatHistory[chatIndex - 1].text : "Research query";

    try {
      // mergeChatInfo now handles structural linking with query context
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
      if (!initialResult || !initialResult.members || initialResult.members.length === 0) {
        setExtractionResult(initialResult);
        setActiveTab('tree');
        return;
      }
      
      const expandedResult = await discoverExtendedFamily(initialResult.members, direction);
      
      // Cleanup generic names if they slipped through
      if (expandedResult.members) {
        expandedResult.members.forEach(m => {
          if (m.name.toLowerCase().includes("the subject") || m.name.toLowerCase() === "subject") {
            m.name = originalName;
          }
        });
      }

      const finalResult: ExtractionResult = {
        ...expandedResult,
        title: expandedResult.title || initialResult.title || `${originalName} Family Tree`,
        description: expandedResult.description || initialResult.description || "Lineage extracted via AI research",
        sources: [...(initialResult.sources || []), ...(expandedResult.sources || [])]
      };
      setExtractionResult(finalResult);
      setActiveTab('tree');
    } catch (err: any) {
      console.error("Lineage expansion failed:", err);
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
        description: prev?.description || expandedResult.description,
        sources: [...(prev?.sources || []), ...(expandedResult.sources || [])]
      }));
      setActiveTab('tree');
    } catch (err: any) {
      setError("Unable to find ancestors. Historical records might be restricted.");
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
        setError(`No records found for "${searchName}". Try adding a location or middle name.`);
        setIsProcessing(false);
        setProcessingStatus(null);
        return;
      }

      // Guard against hallucinations if famous names appear that weren't searched
      const isFamousHallucination = result.members.some(m => 
        (m.name.toLowerCase().includes("kamala") || m.name.toLowerCase().includes("harris")) && 
        !searchName.toLowerCase().includes("kamala")
      );

      if (isFamousHallucination) {
        setError(`The AI returned an unrelated public figure. Please provide more specific details about "${searchName}" (e.g. location or birth year).`);
        setIsProcessing(false);
        setProcessingStatus(null);
        return;
      }

      await processLineage(result, direction, searchName);
    } catch (err: any) {
      setError('Search failed. Please ensure the person is a real individual and try again.');
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
        setError("No death records found. Ensure the person is deceased.");
        setIsProcessing(false);
        setProcessingStatus(null);
        return;
      }
      setExtractionResult(result);
      setActiveTab('tree');
    } catch (err: any) {
      setError('Death record research failed.');
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
      setError('Failed to update family tree.');
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
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      setPreviewImageData(canvas.toDataURL('image/png'));
      setShowPreview(true);
    } catch (err) {
      setError("Record capture failed.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const finalizeDownload = async () => {
    if (!previewImageData) return;
    setIsExporting(true);
    try {
      const img = new Image();
      img.src = previewImageData;
      await new Promise(resolve => img.onload = resolve);
      
      // Fixed page size for one-page export (A4 Landscape is 841.89 x 595.28 px at 72dpi, but we'll use pts)
      const pdf = new jsPDF({
        orientation: 'l',
        unit: 'pt',
        format: 'a4'
      });
      
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      const contentHeight = pageHeight - (margin * 2);
      
      // Calculate scaling to fit content within the A4 page margins
      const imgRatio = img.width / img.height;
      const pageRatio = contentWidth / contentHeight;
      
      let finalWidth, finalHeight;
      if (imgRatio > pageRatio) {
        finalWidth = contentWidth;
        finalHeight = contentWidth / imgRatio;
      } else {
        finalHeight = contentHeight;
        finalWidth = contentHeight * imgRatio;
      }
      
      // Center the image
      const xOffset = (pageWidth - finalWidth) / 2;
      const yOffset = (pageHeight - finalHeight) / 2;
      
      pdf.addImage(previewImageData, 'PNG', xOffset, yOffset, finalWidth, finalHeight);
      pdf.save(`${extractionResult?.title?.replace(/\s+/g, '-') || 'family-lineage'}.pdf`);
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
            await processLineage(result, 'forward', file.name);
          } catch (e) {
            setError("Spreadsheet parsing failed.");
            setIsProcessing(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (isImage) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const result = await extractFamilyData(event.target?.result as string, 'image', file.type || 'application/pdf');
            await processLineage(result, 'forward', file.name);
          } catch (e) {
            setError("Image/PDF analysis failed.");
            setIsProcessing(false);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const result = await extractFamilyData(event.target?.result as string, 'text');
            await processLineage(result, 'forward', "Document Subject");
          } catch (e) {
            setError("Text analysis failed.");
            setIsProcessing(false);
          }
        };
        reader.readAsText(file);
      }
    } catch (err) {
      setError('File processing failed.');
      setIsProcessing(false);
    }
  }, [processLineage]);

  const filteredMembers = useMemo(() => {
    if (!extractionResult?.members) return [];
    if (!searchTerm) return extractionResult.members;
    const lower = searchTerm.toLowerCase();
    return extractionResult.members.filter(m => 
      m.name.toLowerCase().includes(lower) || m.relationship?.toLowerCase().includes(lower)
    );
  }, [extractionResult, searchTerm]);

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
          <button onClick={() => setActiveTab('upload')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'upload' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Input</button>
          <button onClick={() => extractionResult && setActiveTab('tree')} disabled={!extractionResult} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'tree' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'} ${!extractionResult ? 'opacity-50' : ''}`}>Tree View</button>
          <button onClick={() => extractionResult && setActiveTab('list')} disabled={!extractionResult} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'} ${!extractionResult ? 'opacity-50' : ''}`}>List View</button>
        </nav>

        <button onClick={() => { if (window.confirm("Start over?")) { setExtractionResult(null); setInputText(''); setActiveTab('upload'); setChatHistory([]); } }} className="text-slate-300 hover:text-rose-500 p-2"><i className="fas fa-redo-alt"></i></button>
      </header>

      <main className={`flex-1 p-6 ${activeTab === 'upload' ? 'max-w-7xl mx-auto' : 'w-full'} flex flex-col`}>
        {activeTab === 'upload' ? (
          <div className="grid lg:grid-cols-5 gap-8">
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm">
                <h2 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3">
                  <i className="fas fa-search text-indigo-600"></i> Begin Research
                </h2>
                <textarea 
                  className="w-full h-64 p-6 bg-slate-50 border border-slate-200 rounded-3xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200 outline-none transition-all text-slate-700 text-lg"
                  placeholder="Enter a subject name (e.g. 'Jane Doe') to research their heirs."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <button onClick={() => handleInitialSearch('forward')} disabled={isProcessing || !inputText.trim()} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-5 rounded-3xl shadow-xl shadow-indigo-100 disabled:opacity-50 transition-all text-lg flex items-center justify-center gap-2">
                    <i className="fas fa-arrow-down"></i> Heirs
                  </button>
                  <button onClick={() => handleInitialSearch('backward')} disabled={isProcessing || !inputText.trim()} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-5 rounded-3xl shadow-xl shadow-emerald-100 disabled:opacity-50 transition-all text-lg flex items-center justify-center gap-2">
                    <i className="fas fa-arrow-up"></i> Ancestry
                  </button>
                  <button onClick={handleDeathSearch} disabled={isProcessing || !inputText.trim()} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-black py-5 rounded-3xl shadow-xl shadow-rose-100 disabled:opacity-50 transition-all text-lg flex items-center justify-center gap-2">
                    <i className="fas fa-book-dead"></i> Death Records
                  </button>
                </div>
              </div>

              <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm">
                <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                  <i className="fas fa-file-upload text-indigo-600"></i> Records Import
                </h2>
                <label 
                  onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) processFile(file); }}
                  className={`flex flex-col items-center justify-center w-full h-44 border-2 border-dashed rounded-3xl cursor-pointer transition-all ${isDragging ? 'bg-indigo-50 border-indigo-500 scale-[1.01]' : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-indigo-300'}`}
                >
                  <i className="fas fa-cloud-arrow-up text-3xl mb-4 text-slate-300"></i>
                  <p className="text-sm text-slate-600 font-bold">Drop PDF, Spreadsheet, or Image</p>
                </label>
                <input type="file" className="hidden" accept="image/*,application/pdf,.csv,.xlsx,.xls,.txt" onChange={(e) => { const file = e.target.files?.[0]; if (file) processFile(file); }} />
              </div>
            </div>

            <div className="lg:col-span-2 bg-indigo-600 rounded-[3rem] p-12 text-white flex flex-col justify-center shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-12 opacity-10 rotate-12"><i className="fas fa-dna text-[12rem]"></i></div>
              <h3 className="text-4xl font-black mb-8 leading-tight">Lineage Engine</h3>
              <p className="text-indigo-100 leading-relaxed mb-12 text-xl">
                Trace lineage forward (Heirs), backward (Ancestry), or find specific vital records using global archive search grounded in real-time data.
              </p>
              {error && <div className="p-5 bg-rose-500 text-white rounded-2xl text-sm font-black shadow-lg">{error}</div>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-4xl font-black text-slate-900 tracking-tighter mb-2">{extractionResult?.title || "Family Record"}</h2>
                <p className="text-lg text-slate-500 font-medium">{extractionResult?.description || "Archive view"}</p>
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowUpdateModal(true)} 
                  className="px-8 py-4 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-2xl text-sm font-black shadow-sm flex items-center gap-3 hover:bg-indigo-100 transition-all"
                >
                  <i className="fas fa-plus-circle"></i> Add Details
                </button>
                <button onClick={generatePDFPreview} disabled={isProcessing} className="px-8 py-4 bg-white border border-slate-200 text-slate-700 rounded-2xl text-sm font-black shadow-sm flex items-center gap-3 hover:bg-slate-50 transition-all">
                  <i className={`fas ${isProcessing && processingStatus === 'previewing' ? 'fa-circle-notch animate-spin' : 'fa-file-pdf text-rose-500'}`}></i> Export PDF
                </button>
              </div>
            </div>

            {extractionResult?.estateInfo && extractionResult.estateInfo.trim() !== "" && (
              <div className="bg-rose-50 border border-rose-100 p-8 rounded-[2.5rem] shadow-sm animate-in fade-in slide-in-from-top duration-500">
                <h4 className="text-rose-700 font-black text-sm uppercase tracking-widest mb-3 flex items-center gap-3">
                  <i className="fas fa-balance-scale"></i> Probate & Estate Contact
                </h4>
                <p className="text-rose-900 text-lg font-medium leading-relaxed">
                  {extractionResult.estateInfo}
                </p>
              </div>
            )}
            
            <div className="w-full">
               {activeTab === 'tree' ? (
                 <div id="tree-capture-area" className="bg-white rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden">
                    {extractionResult && extractionResult.members && extractionResult.members.length > 0 ? (
                      <TreeVisualization members={extractionResult.members} onResearchAncestors={handleResearchAncestors} />
                    ) : (
                      <div className="p-20 text-center text-slate-400">
                        <i className="fas fa-search-minus text-4xl mb-4"></i>
                        <p className="font-bold">No family members were extracted. Try a more specific search.</p>
                      </div>
                    )}
                 </div>
               ) : (
                 <div id="list-capture-area" className="bg-white rounded-[3rem] border border-slate-200 shadow-sm p-12">
                    {filteredMembers.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                        {filteredMembers.map((member) => (
                          <div key={member.id} className="p-10 rounded-[2.5rem] border-2 bg-white border-slate-100 hover:shadow-2xl transition-all">
                            <h3 className="text-2xl font-black text-slate-900 mb-2">{member.name}</h3>
                            <span className="text-[11px] font-black uppercase tracking-widest text-indigo-600 block mb-6">{member.relationship || 'Legacy Member'}</span>
                            <div className="bg-slate-50 p-5 rounded-2xl text-center mb-8">
                              <p className="text-sm font-black text-slate-800">{member.birthYear || '????'} — {member.deathYear || 'Now'}</p>
                            </div>
                            <button onClick={() => handleResearchAncestors(member.id)} className="w-full py-4 bg-white border-2 border-slate-200 rounded-2xl text-[12px] font-black text-slate-700 hover:border-indigo-600 hover:text-indigo-600 transition-all flex items-center justify-center gap-3">
                               <i className="fas fa-history"></i> Ancestry
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-20 text-slate-400 font-bold">No members in list view.</div>
                    )}
                 </div>
               )}
            </div>

            {extractionResult?.sources && extractionResult.sources.length > 0 && (
              <div className="mt-12">
                <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-3">
                  <i className="fas fa-link text-indigo-600"></i> Research Sources Found
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {extractionResult.sources.map((source, idx) => (
                    <a 
                      key={idx} 
                      href={source.uri} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-6 bg-white border border-slate-200 rounded-3xl hover:border-indigo-400 hover:shadow-xl transition-all flex items-center justify-between group"
                    >
                      <div className="flex-1 overflow-hidden">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Source Link</p>
                        <h4 className="text-slate-800 font-bold text-sm truncate pr-4 group-hover:text-indigo-600 transition-colors">{source.title}</h4>
                      </div>
                      <i className="fas fa-external-link-alt text-slate-300 group-hover:text-indigo-600 transition-colors"></i>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Global AI Chat Bar */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-6 z-[80] group">
        {isChatOpen && chatHistory.length > 0 && (
          <div className="mb-4 bg-white/90 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-indigo-100 p-8 max-h-[50vh] overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-white/50 backdrop-blur-sm py-2">
              <h4 className="text-xs font-black uppercase tracking-[0.3em] text-indigo-600 flex items-center gap-2">
                <i className="fas fa-sparkles"></i> Research Assistant
              </h4>
              <button onClick={() => { setIsChatOpen(false); setChatHistory([]); }} className="text-slate-400 hover:text-slate-600"><i className="fas fa-times"></i></button>
            </div>
            <div className="space-y-6">
              {chatHistory.map((chat) => (
                <div key={chat.id} className={`flex flex-col ${chat.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] p-5 rounded-3xl text-sm font-medium leading-relaxed ${chat.role === 'user' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-50 text-slate-700 border border-slate-100'}`}>
                    {chat.text}
                  </div>
                  {chat.role === 'ai' && chat.text !== "I'm sorry, I couldn't process that question." && (
                    <div className="mt-3 flex gap-2">
                      <button 
                        onClick={() => handleMergeChatResult(chat.id, chat.text)}
                        className="text-[10px] font-black bg-indigo-600 text-white px-4 py-2 rounded-full shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center gap-2"
                      >
                        <i className="fas fa-plus-circle"></i> Add findings to tree
                      </button>
                    </div>
                  )}
                  {chat.sources && chat.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 w-full max-w-[85%]">
                      {chat.sources.map((src, sIdx) => (
                        <a 
                          key={sIdx} 
                          href={src.uri} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[10px] font-black bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full border border-indigo-100 hover:bg-indigo-100 transition-all flex items-center gap-1.5"
                        >
                          <i className="fas fa-link text-[8px]"></i> {src.title.length > 20 ? src.title.substring(0, 20) + '...' : src.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {processingStatus === 'chatting' && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 flex gap-2">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></span>
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-100"></span>
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-200"></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
        )}
        <form onSubmit={handleChatSubmit} className="relative flex items-center">
          <input 
            type="text"
            className="w-full h-16 pl-14 pr-24 bg-white/80 backdrop-blur-2xl border-2 border-indigo-100 rounded-full shadow-2xl focus:ring-8 focus:ring-indigo-600/5 focus:border-indigo-500 outline-none transition-all text-slate-700 font-bold placeholder:text-slate-400"
            placeholder="Ask anything (e.g. 'Who were Prince Philip's parents?')"
            value={chatQuery}
            onChange={(e) => setChatQuery(e.target.value)}
          />
          <div className="absolute left-6 text-indigo-500"><i className="fas fa-sparkles"></i></div>
          <button 
            type="submit" 
            disabled={!chatQuery.trim() || processingStatus === 'chatting'}
            className="absolute right-2 h-12 px-6 bg-indigo-600 text-white rounded-full font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:opacity-50"
          >
            Ask AI
          </button>
        </form>
      </div>

      {/* MODALS */}
      {isProcessing && !showPreview && processingStatus !== 'chatting' && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-2xl z-[70] flex items-center justify-center p-6">
              <div className="bg-white p-20 rounded-[4rem] shadow-2xl max-w-lg w-full text-center border border-indigo-50 animate-in zoom-in duration-300">
                  <div className="relative w-32 h-32 mx-auto mb-12">
                    <div className="absolute inset-0 border-[8px] border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <i className={`fas ${processingStatus === 'merging' ? 'fa-sync animate-spin' : 'fa-search'} text-indigo-600 text-4xl`}></i>
                    </div>
                  </div>
                  <h3 className="text-3xl font-black text-slate-900 mb-5">
                    {processingStatus === 'researching' ? 'Mining Archives' : 
                     processingStatus === 'merging' ? 'Integrating Records' : 'Processing Records'}
                  </h3>
                  <p className="text-slate-500 text-lg leading-relaxed font-medium">Please wait. Gemini is finalizing the results.</p>
              </div>
          </div>
      )}

      {showUpdateModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xl z-[60] flex items-center justify-center p-6">
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl max-w-2xl w-full border border-indigo-50 animate-in zoom-in duration-300">
            <h3 className="text-3xl font-black text-slate-900 mb-8">Add Additional Context</h3>
            <textarea 
              className="w-full h-48 p-6 bg-slate-50 border border-slate-200 rounded-3xl focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all text-slate-700 text-lg mb-8"
              placeholder="Provide more stories, names, or corrections to the current tree."
              value={updateText}
              onChange={(e) => setUpdateText(e.target.value)}
            />
            <div className="flex gap-4">
              <button onClick={() => setShowUpdateModal(false)} className="flex-1 py-4 rounded-2xl text-sm font-black text-slate-500 hover:bg-slate-100 transition-all">Cancel</button>
              <button onClick={handleUpdateSubmit} disabled={!updateText.trim()} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-xl hover:bg-indigo-700 transition-all disabled:opacity-50">Refine Tree</button>
            </div>
          </div>
        </div>
      )}

      {showPreview && previewImageData && (
        <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-2xl z-[60] flex items-center justify-center p-4 md:p-10">
          <div className="bg-white rounded-[4rem] shadow-2xl max-w-7xl w-full max-h-full flex flex-col overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="px-12 py-10 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-3xl font-black text-slate-900 tracking-tight">Export Record</h3>
              <button onClick={() => setShowPreview(false)} className="w-14 h-14 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-all"><i className="fas fa-times text-2xl"></i></button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-12 flex items-start justify-center">
              <img src={previewImageData} alt="Capture preview" className="max-w-full h-auto shadow-2xl rounded-lg" />
            </div>
            <div className="px-12 py-10 border-t border-slate-100 flex items-center justify-end gap-6 bg-white">
                <button onClick={() => setShowPreview(false)} className="px-10 py-4 rounded-3xl text-sm font-black text-slate-500 hover:bg-slate-100 transition-all">Cancel</button>
                <button onClick={finalizeDownload} disabled={isExporting} className="px-16 py-4 bg-indigo-600 text-white rounded-3xl text-sm font-black shadow-2xl shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-4 disabled:opacity-50">
                  {isExporting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-file-pdf"></i>}
                  {isExporting ? 'Generating...' : 'Save PDF'}
                </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
