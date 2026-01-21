
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { FamilyMember } from '../types';

interface TreeVisualizationProps {
  members: FamilyMember[];
  onResearchAncestors?: (memberId?: string) => void;
}

const TreeVisualization: React.FC<TreeVisualizationProps> = ({ members = [], onResearchAncestors }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const nodesLayerRef = useRef<HTMLDivElement>(null);
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [zoomLevel, setZoomLevel] = useState(1);

  const zoomBehaviorRef = useRef<any>(null);

  useEffect(() => {
    if (!svgRef.current || !nodesLayerRef.current || !Array.isArray(members) || members.length === 0 || !containerRef.current) return;

    const svgElement = d3.select(svgRef.current);
    const nodesLayer = d3.select(nodesLayerRef.current);
    const container = d3.select(containerRef.current);
    
    svgElement.selectAll("*").remove();
    nodesLayer.selectAll("*").remove();

    const nodeWidth = 240;
    const nodeHeight = 120;
    const verticalGap = 200;
    const horizontalGap = 80;
    const padding = 120;

    const generations: Record<string, number> = {};
    const processed = new Set<string>();

    const assignGen = (id: string, gen: number) => {
      if (!id || processed.has(id)) return;
      generations[id] = gen;
      processed.add(id);
      
      const member = members.find(m => m.id === id);
      if (member) {
        const children = members.filter(m => m.parents?.includes(id));
        children.forEach(c => assignGen(c.id, gen + 1));
        member.partners?.forEach(pId => assignGen(pId, gen));
      }
    };

    const rootNodes = members.filter(m => !m.parents || m.parents.length === 0);
    rootNodes.forEach(r => assignGen(r.id, 0));
    members.forEach(m => { if (!processed.has(m.id)) assignGen(m.id, 0); });

    const genGroups: Record<number, string[]> = {};
    members.forEach(m => {
      const gen = generations[m.id] ?? 0;
      if (!genGroups[gen]) genGroups[gen] = [];
      genGroups[gen].push(m.id);
    });

    const nodePositions: Record<string, { x: number, y: number }> = {};
    let maxWidth = 0;
    let maxHeight = 0;

    Object.keys(genGroups).forEach(genStr => {
      const gen = parseInt(genStr);
      const idsInGen = genGroups[gen];
      const sortedIds: string[] = [];
      const visitedInRow = new Set<string>();
      
      idsInGen.forEach(id => {
        if (visitedInRow.has(id)) return;
        const member = members.find(m => m.id === id);
        const partnersInRow = member?.partners?.filter(pId => idsInGen.includes(pId)) || [];
        
        if (partnersInRow.length > 0) {
          const partnerId = partnersInRow[0];
          const partner = members.find(p => p.id === partnerId);
          if (member?.gender === 'female' && partner?.gender === 'male') {
            sortedIds.push(partnerId, id);
          } else {
            sortedIds.push(id, partnerId);
          }
          visitedInRow.add(id);
          visitedInRow.add(partnerId);
        } else {
          sortedIds.push(id);
          visitedInRow.add(id);
        }
      });

      sortedIds.forEach((id, index) => {
        const x = padding + index * (nodeWidth + horizontalGap);
        const y = padding + gen * verticalGap;
        nodePositions[id] = { x, y };
        maxWidth = Math.max(maxWidth, x + nodeWidth + padding);
        maxHeight = Math.max(maxHeight, y + nodeHeight + padding);
      });
    });

    setDimensions({ width: maxWidth, height: maxHeight });

    const svg = svgElement
      .attr("width", maxWidth)
      .attr("height", maxHeight);

    const gLines = svg.append("g").attr("class", "lines-layer");

    members.forEach(m => {
      const pos = nodePositions[m.id];
      if (!pos) return;
      m.partners?.forEach(pId => {
        const pPos = nodePositions[pId];
        if (pPos && members.indexOf(m) < members.indexOf(members.find(x => x.id === pId)!)) {
          gLines.append("line")
            .attr("x1", pos.x + nodeWidth)
            .attr("y1", pos.y + nodeHeight / 2)
            .attr("x2", pPos.x)
            .attr("y2", pPos.y + nodeHeight / 2)
            .attr("stroke", "#cbd5e1")
            .attr("stroke-width", 3)
            .attr("stroke-dasharray", "8,8");
        }
      });
    });

    members.forEach(m => {
      if (m.parents && m.parents.length > 0) {
        const childPos = nodePositions[m.id];
        if (!childPos) return;
        m.parents.forEach(parentId => {
          const pPos = nodePositions[parentId];
          if (pPos) {
            const startX = pPos.x + nodeWidth / 2;
            const startY = pPos.y + nodeHeight;
            const endX = childPos.x + nodeWidth / 2;
            const endY = childPos.y;
            const midY = startY + (endY - startY) * 0.5;
            const path = `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
            gLines.append("path")
              .attr("d", path)
              .attr("fill", "none")
              .attr("stroke", m.status === 'possible' ? '#e2e8f0' : '#64748b')
              .attr("stroke-width", m.status === 'possible' ? 2 : 3)
              .attr("stroke-linejoin", "round")
              .attr("stroke-linecap", "round");
          }
        });
      }
    });

    const nodes = nodesLayer.selectAll(".member-node")
      .data(members)
      .enter()
      .append("div")
      .attr("class", "absolute cursor-pointer member-node pointer-events-auto")
      .style("width", `${nodeWidth}px`)
      .style("height", `${nodeHeight}px`)
      .style("left", d => `${nodePositions[d.id]?.x}px`)
      .style("top", d => `${nodePositions[d.id]?.y}px`)
      .on("click", (event, d) => {
        setSelectedMember(d);
        event.stopPropagation();
      });

    nodes.each(function(d) {
      const nodeEl = d3.select(this);
      const genderClass = d.gender === 'male' ? 'bg-blue-50 border-blue-200' : 
                         (d.gender === 'female' ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200');
      const vitalBadge = d.vitalStatus === 'living' ? 
        '<span class="text-[9px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-black">LIVING</span>' :
        (d.vitalStatus === 'deceased' ? '<span class="text-[9px] px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full font-black">DECEASED</span>' : '');

      nodeEl.html(`
        <div class="h-full p-6 rounded-[2rem] border-2 flex flex-col justify-between transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 hover:border-indigo-400 bg-white ${genderClass}">
          <div class="flex-1 overflow-hidden">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[9px] font-black uppercase tracking-[0.25em] text-indigo-500/80 truncate mr-2">${d.relationship || 'Profile'}</span>
              <i class="fas ${d.gender === 'male' ? 'fa-mars text-blue-400' : (d.gender === 'female' ? 'fa-venus text-rose-400' : 'fa-user text-slate-300')} text-[10px]"></i>
            </div>
            <h3 class="font-black text-slate-900 text-base overflow-hidden whitespace-nowrap text-ellipsis leading-tight">${d.name}</h3>
          </div>
          <div class="flex items-center justify-between mt-3 pt-3 border-t border-slate-100/50">
            <p class="text-[10px] text-slate-500 font-black">${d.birthYear || '????'} — ${d.deathYear || 'Now'}</p>
            ${vitalBadge}
          </div>
        </div>
      `);
    });

    const zoom = d3.zoom()
      .scaleExtent([0.05, 4])
      .on("zoom", (event) => {
        if (viewportRef.current) {
          const { x, y, k } = event.transform;
          d3.select(viewportRef.current).style("transform", `translate(${x}px, ${y}px) scale(${k})`);
          setZoomLevel(k);
        }
      });

    container.call(zoom as any);
    zoomBehaviorRef.current = zoom;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    if (maxWidth > 0 && maxHeight > 0) {
        const scale = Math.min(containerWidth / maxWidth, containerHeight / maxHeight) * 0.8;
        container.call(zoom.transform as any, d3.zoomIdentity
            .translate(containerWidth/2, containerHeight/2)
            .scale(scale)
            .translate(-maxWidth/2, -maxHeight/2)
        );
    }

  }, [members]);

  const handleZoomIn = () => {
    if (zoomBehaviorRef.current && containerRef.current) {
      d3.select(containerRef.current).transition().duration(300).call(zoomBehaviorRef.current.scaleBy, 1.4);
    }
  };

  const handleZoomOut = () => {
    if (zoomBehaviorRef.current && containerRef.current) {
      d3.select(containerRef.current).transition().duration(300).call(zoomBehaviorRef.current.scaleBy, 0.7);
    }
  };

  const handleZoomFit = () => {
    if (zoomBehaviorRef.current && containerRef.current && dimensions.width > 0) {
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const scale = Math.min(w / dimensions.width, h / dimensions.height) * 0.9;
      
      d3.select(containerRef.current).transition()
        .duration(750)
        .call(
          zoomBehaviorRef.current.transform,
          d3.zoomIdentity
            .translate(w / 2, h / 2)
            .scale(scale)
            .translate(-dimensions.width / 2, -dimensions.height / 2)
        );
    }
  };

  const handleZoomReset = () => {
    if (zoomBehaviorRef.current && containerRef.current) {
      d3.select(containerRef.current).transition().duration(500).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
    }
  };

  if (!members || members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400 gap-4">
        <i className="fas fa-sitemap text-4xl"></i>
        <p className="font-bold">No family members found to display.</p>
      </div>
    );
  }

  return (
    <div 
      className="relative bg-white rounded-[3rem] overflow-hidden custom-scrollbar h-[700px] w-full border border-slate-100 cursor-grab active:cursor-grabbing"
      ref={containerRef}
    >
      <div className="absolute top-6 left-6 z-20 flex flex-col gap-3">
        <button 
          onClick={handleZoomIn}
          className="w-12 h-12 bg-white/80 backdrop-blur-md rounded-2xl shadow-lg border border-slate-100 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 flex items-center justify-center transition-all"
          title="Zoom In"
        >
          <i className="fas fa-plus"></i>
        </button>
        <button 
          onClick={handleZoomOut}
          className="w-12 h-12 bg-white/80 backdrop-blur-md rounded-2xl shadow-lg border border-slate-100 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 flex items-center justify-center transition-all"
          title="Zoom Out"
        >
          <i className="fas fa-minus"></i>
        </button>
        <button 
          onClick={handleZoomFit}
          className="w-12 h-12 bg-white/80 backdrop-blur-md rounded-2xl shadow-lg border border-slate-100 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 flex items-center justify-center transition-all"
          title="Shrink to Fit"
        >
          <i className="fas fa-compress-arrows-alt"></i>
        </button>
        <button 
          onClick={handleZoomReset}
          className="w-12 h-12 bg-white/80 backdrop-blur-md rounded-2xl shadow-lg border border-slate-100 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 flex items-center justify-center transition-all"
          title="Reset View"
        >
          <i className="fas fa-undo"></i>
        </button>
        <div className="bg-white/80 backdrop-blur-md rounded-2xl px-4 py-2 shadow-lg border border-slate-100 text-[10px] font-black text-slate-400 text-center uppercase tracking-widest">
          {Math.round(zoomLevel * 100)}%
        </div>
      </div>

      <div 
        ref={viewportRef}
        className="relative origin-top-left will-change-transform"
        style={{ width: dimensions.width, height: dimensions.height }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(#f1f5f9_2px,transparent_2px)] [background-size:60px_60px] pointer-events-none opacity-40"></div>
        <svg ref={svgRef} className="absolute inset-0 pointer-events-none"></svg>
        <div ref={nodesLayerRef} className="absolute inset-0 pointer-events-none"></div>
      </div>
      
      {selectedMember && (
        <div className="fixed top-28 right-10 w-96 bg-white rounded-[3rem] shadow-2xl border border-slate-200 p-10 animate-in slide-in-from-right duration-300 z-50 pointer-events-auto">
          <div className="flex justify-between items-start mb-10">
            <div>
               <h4 className="font-black text-slate-900 text-2xl tracking-tight">Record Archive</h4>
               <p className="text-[11px] text-indigo-500 font-black uppercase tracking-[0.3em] mt-2">Historical Reference: {selectedMember.id}</p>
            </div>
            <button onClick={() => setSelectedMember(null)} className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-all"><i className="fas fa-times text-xl"></i></button>
          </div>
          
          <div className="space-y-8">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Subject Name</label>
              <p className="text-3xl font-black text-slate-900 leading-none tracking-tight">{selectedMember.name}</p>
              <p className="text-sm text-indigo-600 font-black mt-3 uppercase tracking-wider">{selectedMember.relationship || 'Family Profile'}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-center">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Birth</label>
                <p className="text-lg font-black text-slate-800">{selectedMember.birthYear || '????'}</p>
              </div>
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-center">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Death</label>
                <p className="text-lg font-black text-slate-800">{selectedMember.deathYear || 'Living'}</p>
              </div>
            </div>
            
            {selectedMember.notes && (
              <div className="pt-6 border-t border-slate-100">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Biography & Archive Notes</label>
                <p className="text-xs text-slate-600 italic font-medium leading-relaxed bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  "{selectedMember.notes}"
                </p>
              </div>
            )}

            <div className="pt-8 space-y-3">
               <button 
                onClick={() => {
                  if (onResearchAncestors) onResearchAncestors(selectedMember.id);
                  setSelectedMember(null);
                }}
                className="w-full py-5 bg-indigo-600 text-white rounded-3xl text-sm font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-4"
               >
                 <i className="fas fa-history"></i> Ancestry
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TreeVisualization;
