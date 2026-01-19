
import React from 'react';
import { FamilyMember } from '../types';

interface FamilyNodeProps {
  member: FamilyMember;
  isSelected?: boolean;
}

const FamilyNode: React.FC<FamilyNodeProps> = ({ member, isSelected }) => {
  const getGenderColor = (gender?: string) => {
    switch (gender) {
      case 'male': return 'bg-blue-50 border-blue-200';
      case 'female': return 'bg-rose-50 border-rose-200';
      default: return 'bg-slate-50 border-slate-200';
    }
  };

  const getGenderIcon = (gender?: string) => {
    switch (gender) {
      case 'male': return <i className="fas fa-mars text-blue-500 text-xs"></i>;
      case 'female': return <i className="fas fa-venus text-rose-500 text-xs"></i>;
      default: return <i className="fas fa-user text-slate-400 text-xs"></i>;
    }
  };

  return (
    <div className={`p-3 rounded-xl border-2 shadow-sm transition-all duration-200 min-w-[160px] max-w-[200px] ${getGenderColor(member.gender)} ${isSelected ? 'ring-2 ring-indigo-500 scale-105 z-10' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {member.relationship || 'Member'}
        </span>
        {getGenderIcon(member.gender)}
      </div>
      
      <h3 className="font-bold text-slate-800 text-sm truncate" title={member.name}>
        {member.name}
      </h3>
      
      <p className="text-[11px] text-slate-500 mt-0.5">
        {member.birthYear || 'Unknown'} — {member.deathYear || 'Present'}
      </p>

      {member.notes && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 italic line-clamp-2">
            {member.notes}
          </p>
        </div>
      )}
    </div>
  );
};

export default FamilyNode;
