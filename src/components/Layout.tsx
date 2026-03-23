import React from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode } from '../types';
import { HelpCircle, ChevronLeft, Camera, Lightbulb, RotateCcw } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

const IconBox = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
  <div className={`w-10 h-10 rounded-lg border border-gray-100 shadow-sm flex items-center justify-center bg-white shrink-0 ${className}`}>
    {children}
  </div>
);

const RightArrow = () => (
  <svg className="w-4 h-4 text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
  </svg>
);


const WordIcon = () => (
  <div className="w-8 h-8 bg-[#2b579a] rounded flex items-center justify-center text-white font-black text-lg shadow-sm">W</div>
);

const CSVIcon = () => (
  <div className="w-8 h-8 bg-[#1d6f42] rounded flex flex-col items-center justify-center text-white font-black shadow-sm leading-none text-[10px]">CSV</div>
);

const CanvasLogo = () => (
  <div className="relative w-10 h-10 flex items-center justify-center bg-white rounded-xl shadow-sm border border-slate-100">
    <svg viewBox="0 0 100 100" className="w-6 h-6" xmlns="http://www.w3.org/2000/svg">
      <g fill="#E63027">
        {/* 8 outer crescents — dome pointing outward, flat side toward center */}
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(45, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(90, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(135, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(180, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(225, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(270, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(315, 50, 50)" />
        {/* 8 inner dots interspersed at 22.5° offset */}
        <circle cx="50" cy="28" r="5" transform="rotate(22.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(67.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(112.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(157.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(202.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(247.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(292.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(337.5, 50, 50)" />
      </g>
    </svg>
  </div>
);


export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { state, setCurrentStep, setHelpOpen, clearSession, setHasDraftRubric } = useSession();

  const getRibbonContent = () => {
    const baseClasses = 'flex items-center gap-3';

    switch (state.currentStep) {
      case AppMode.DASHBOARD:
        return (
          <div className={baseClasses}>
            <IconBox className="bg-amber-50"><Lightbulb className="w-5 h-5 text-amber-500" /></IconBox>
            <RightArrow />
            <IconBox><WordIcon /></IconBox>
            <RightArrow />
            <IconBox><CSVIcon /></IconBox>
            <RightArrow />
            <IconBox><CanvasLogo /></IconBox>
          </div>
        );
      case AppMode.PART_1:
        return (
          <div className={baseClasses}>
            <IconBox className="bg-amber-50"><Lightbulb className="w-5 h-5 text-amber-500" /></IconBox>
            <RightArrow />
            <IconBox><WordIcon /></IconBox>
            <span className="text-sm font-black uppercase tracking-widest ml-2">
              <span className="text-[#2B579A]">Phase 1: </span><span className="text-gray-900">Create Draft Rubric</span>
            </span>
          </div>
        );
      case AppMode.PART_2:
        return (
          <div className={baseClasses}>
            <IconBox><WordIcon /></IconBox>
            <RightArrow />
            <IconBox><CSVIcon /></IconBox>
            <span className="text-sm font-black uppercase tracking-widest ml-2">
              <span className="text-[#1d6f42]">Phase 2: </span><span className="text-gray-900">Convert to CSV</span>
            </span>
          </div>
        );
      case AppMode.PART_3:
        return (
          <div className={baseClasses}>
            <IconBox><CanvasLogo /></IconBox>
            <span className="text-sm font-black uppercase tracking-widest ml-2">
              <span className="text-[#E64C3C]">Phase 3: </span><span className="text-gray-900">Deploy to Canvas</span>
            </span>
          </div>
        );
      case AppMode.SCREENSHOT:
        return (
          <div className={baseClasses}>
            <IconBox className="bg-purple-50">
              <Camera className="w-5 h-5 text-purple-600" />
            </IconBox>
            <RightArrow />
            <IconBox><WordIcon /></IconBox>
            <span className="text-sm font-black uppercase tracking-widest ml-2">
              <span className="text-[#2B579A]">Phase 1: </span><span className="text-gray-900">Convert Screenshot</span>
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  const showReturnButton = state.currentStep !== AppMode.DASHBOARD;

  return (
    <div className="flex flex-col h-screen bg-gray-50 relative overflow-hidden">
      {/* Blue Banner */}
      <div className="bg-[#0033a0] text-white py-6 px-8 sm:px-12 flex items-center justify-between shadow-lg z-50">
        <div>
          <h1 className="text-xl font-black">The Canvas Rubric Creator App <span className="font-normal opacity-75">V.2</span></h1>
          <p className="text-xs text-blue-100">Streamlined rubric workflow</p>
        </div>
        <p className="text-xs text-blue-200 font-medium self-end">Part of the IDS TOOLKIT</p>
      </div>

      {/* White Ribbon Bar */}
      <div className="bg-white border-b border-gray-200 py-3 px-8 sm:px-12 flex items-center justify-between shadow-sm z-40">
        {/* Left Side: Workflow Sequence */}
        <div className="hidden sm:flex">
          {getRibbonContent()}
        </div>

        {/* Right Side: Help & Return Button */}
        <div className="flex items-center gap-6 ml-auto">
          {state.hasDraftRubric !== null && (
            <button
              onClick={() => { clearSession(); setHasDraftRubric(null); }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-gray-700 rounded-xl transition-all font-bold text-sm border border-gray-200 active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Clear Work & Start Over</span>
            </button>
          )}
          <button
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-all font-bold text-sm border border-gray-200 active:scale-95"
          >
            <HelpCircle className="w-5 h-5" />
            <span>Help Center & More</span>
          </button>

          {showReturnButton && (
            <button
              onClick={() => setCurrentStep(AppMode.DASHBOARD)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Dashboard
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50/50">
        {children}
      </main>
    </div>
  );
};
