
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { FamilyMember } from '../types';

interface TreeVisualizationProps {
  members: FamilyMember[];
  onResearchAncestors?: (memberId?: string) => void;
}

const TreeVisualization: React.FC<TreeVisualizationProps> = ({ members, onResearchAncestors }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);

  useEffect(() => {
    if (!svgRef.current || members.length === 0) return;

    const svgElement = d3.select(svgRef.current);
    svgElement.selectAll("*").remove();

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;

    const svg = svgElement
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    const g = svg.append("g");

    const nodeWidth = 230;
    const nodeHeight = 100;
    const verticalGap = 180;
    const horizontalGap = 50;

    // 1. Calculate Generations
    const generations: Record<string, number> = {};
    const processed = new Set<string>();

    const assignGen = (id: string, gen: number) => {
      if (processed.has(id)) {
        if (generations[id] < gen) generations[id] = gen;
        return;
      }
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

    // 2. Position Nodes (Husband left, Wife right)
    const genGroups: Record<number, string[]> = {};
    members.forEach(m => {
      const gen = generations[m.id] || 0;
      if (!genGroups[gen]) genGroups[gen] = [];
      genGroups[gen].push(m.id);
    });

    const nodePositions: Record<string, { x: number, y: number }> = {};
    
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
            sortedIds.push(partnerId);
            sortedIds.push(id);
          } else {
            sortedIds.push(id);
            sortedIds.push(partnerId);
          }
          visitedInRow.add(id);
          visitedInRow.add(partnerId);
        } else {
          sortedIds.push(id);
          visitedInRow.add(id);
        }
      });

      const rowWidth = sortedIds.length * (nodeWidth + horizontalGap) - horizontalGap;
      const startX = (width - rowWidth) / 2;

      sortedIds.forEach((id, index) => {
        nodePositions[id] = {
          x: startX + index * (nodeWidth + horizontalGap),
          y: 80 + gen * verticalGap
        };
      });
    });

    // 3. Lines
    members.forEach(m => {
      const pos = nodePositions[m.id];
      m.partners?.forEach(pId => {
        const pPos = nodePositions[pId];
        if (pPos && members.indexOf(m) < members.indexOf(members.find(x => x.id === pId)!)) {
          g.append("line")
            .attr("x1", pos.x + nodeWidth)
            .attr("y1", pos.y + nodeHeight / 2)
            .attr("x2", pPos.x)
            .attr("y2", pPos.y + nodeHeight / 2)
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "4,4");
        }
      });
    });

    members.forEach(m => {
      if (m.parents && m.parents.length > 0) {
        const childPos = nodePositions[m.id];
        m.parents.forEach(parentId => {
          const pPos = nodePositions[parentId];
          if (pPos) {
            const startX = pPos.x + nodeWidth / 2;
            const startY = pPos.y + nodeHeight;
            const endX = childPos.x + nodeWidth / 2;
            const endY = childPos.y;
            const midY = startY + (endY - startY) * 0.5;
            const path = `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
            g.append("path")
              .attr("d", path)
              .attr("fill", "none")
              .attr("stroke", m.status === 'possible' ? '#cbd5e1' : '#475569')
              .attr("stroke-width", m.status === 'possible' ? 1.5 : 2.5)
              .attr("stroke-dasharray", m.status === 'possible' ? "4,4" : "0")
              .attr("stroke-linejoin", "round")
              .attr("stroke-linecap", "round");
          }
        });
      }
    });

    // 4. Nodes
    const nodes = g.selectAll(".member-node")
      .data(members)
      .enter()
      .append("foreignObject")
      .attr("width", nodeWidth)
      .attr("height", nodeHeight * 1.5)
      .attr("x", d => nodePositions[d.id].x)
      .attr("y", d => nodePositions[d.id].y)
      .on("click", (event, d) => {
        setSelectedMember(d);
        event.stopPropagation();
      });

    nodes.each(function(d) {
      const container = d3.select(this).append("xhtml:div")
        .style("width", "100%")
        .style("height", "100%")
        .attr("class", "cursor-pointer p-1 group");

      const genderClass = d.gender === 'male' ? 'bg-blue-50/50 border-blue-200' : 
                         (d.gender === 'female' ? 'bg-rose-50/50 border-rose-200' : 'bg-white border-slate-200');
      
      const statusBorder = d.status === 'probable' ? 'border-dashed border-amber-300' :
                          (d.status === 'possible' ? 'border-dotted border-slate-300 opacity-75' : 'border-solid shadow-sm');

      const vitalBadge = d.vitalStatus === 'living' ? 
        '<span class="text-[8px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold">LIVING</span>' :
        (d.vitalStatus === 'deceased' ? '<span class="text-[8px] px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded-full font-bold">DECEASED</span>' : '');

      container.html(`
        <div class="h-[90px] p-3 rounded-xl border-2 flex flex-col justify-between transition-all duration-300 group-hover:shadow-md group-hover:border-indigo-400 ${genderClass} ${statusBorder}">
          <div>
            <div class="flex items-center justify-between mb-0.5">
              <span class="text-[8px] font-black uppercase tracking-[0.1em] text-indigo-500/70 truncate mr-2">${d.relationship || 'Relative'}</span>
              <i class="fas ${d.gender === 'male' ? 'fa-mars text-blue-400' : (d.gender === 'female' ? 'fa-venus text-rose-400' : 'fa-user text-slate-300')} text-[9px]"></i>
            </div>
            <h3 class="font-bold text-slate-800 text-xs truncate leading-tight">${d.name}</h3>
          </div>
          <div class="flex items-center justify-between mt-1 pt-1 border-t border-slate-100/50">
            <p class="text-[9px] text-slate-500 font-bold">${d.birthYear || '????'} — ${d.deathYear || 'Now'}</p>
            ${vitalBadge}
          </div>
        </div>
      `);
    });

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));

    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity.translate(width * 0.1, 40).scale(0.85));

  }, [members]);

  return (
    <div 
      id="tree-capture-area" 
      className="relative w-full h-full overflow-hidden bg-white rounded-2xl" 
      ref={containerRef}
    >
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]"></svg>
      
      {selectedMember && (
        <div className="absolute top-4 right-4 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 animate-in slide-in-from-right duration-300 z-40 print:hidden">
          <div className="flex justify-between items-start mb-6">
            <div>
               <h4 className="font-bold text-slate-900 text-lg">Member Details</h4>
               <div className="flex gap-2 mt-1">
                 {selectedMember.status && selectedMember.status !== 'definitive' && (
                   <span className={`inline-block text-[9px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider ${selectedMember.status === 'probable' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                     {selectedMember.status} Match
                   </span>
                 )}
                 {selectedMember.vitalStatus && (
                   <span className={`inline-block text-[9px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider ${selectedMember.vitalStatus === 'living' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                     {selectedMember.vitalStatus}
                   </span>
                 )}
               </div>
            </div>
            <button onClick={() => setSelectedMember(null)} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors"><i className="fas fa-times"></i></button>
          </div>
          <div className="space-y-6">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Full Name & Relation</label>
              <p className="text-slate-900 font-bold">{selectedMember.name}</p>
              <p className="text-xs text-indigo-600 font-bold">{selectedMember.relationship || 'Family Member'}</p>
            </div>
            
            <button 
              onClick={() => {
                if (onResearchAncestors) {
                  onResearchAncestors(selectedMember.id);
                  setSelectedMember(null);
                }
              }}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
            >
              <i className="fas fa-history"></i> Search For Previous Ancestors
            </button>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Born</label>
                <p className="text-slate-700 font-bold">{selectedMember.birthYear || 'N/A'}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Died</label>
                <p className="text-slate-700 font-bold">{selectedMember.deathYear || 'N/A'}</p>
              </div>
            </div>
            
            {selectedMember.notes && (
              <div className="pt-4 border-t border-slate-100">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 text-slate-400">Biography</label>
                <p className="text-xs text-slate-600 leading-relaxed italic bg-indigo-50/30 p-4 rounded-xl border border-indigo-50">{selectedMember.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TreeVisualization;
