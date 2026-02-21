import React from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode } from '../types';
import { HelpCircle, ChevronRight } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

const IconBox = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
  <div className={`w-10 h-10 rounded-lg border border-gray-100 shadow-sm flex items-center justify-center bg-white shrink-0 ${className}`}>
    {children}
  </div>
);

const RightArrow = () => (
  <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
  </svg>
);

const LightbulbIcon = () => (
  <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.343a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM16.657 14.657a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM11 17v1a1 1 0 11-2 0v-1a1 1 0 112 0zM5.343 15.657a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM2 10a1 1 0 01 1 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM4.343 5.343A1 1 0 005.757 3.929l.707.707a1 1 0 11-1.414 1.414l-.707-.707z" />
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
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
      {/* Canvas LMS red circle with white C */}
      <circle cx="12" cy="12" r="11" fill="#C1272D"/>
      <path d="M7.5 10 Q 7 10 7 12 Q 7 14 7.5 14 L 14 14 L 14 13 L 8.5 13 Q 8 13 8 12 Q 8 11 8.5 11 L 14 11 L 14 10 Z" fill="white"/>
    </svg>
  </div>
);

const CameraIcon = () => (
  <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 000-2H4zm0 0A2 2 0 002 7v6a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 000-2H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
  </svg>
);

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { state, setCurrentStep, setHelpOpen } = useSession();

  const getRibbonContent = () => {
    const baseClasses = 'flex items-center gap-3';

    switch (state.currentStep) {
      case AppMode.DASHBOARD:
        return (
          <div className={baseClasses}>
            <IconBox><LightbulbIcon /></IconBox>
            <RightArrow />
            <IconBox><WordIcon /></IconBox>
            <RightArrow />
            <IconBox><CSVIcon /></IconBox>
            <RightArrow />
            <IconBox><CanvasLogo /></IconBox>
            <div className="h-6 w-px bg-gray-200 mx-2" />
            <span className="text-sm font-black text-gray-400 uppercase tracking-widest">Dashboard</span>
          </div>
        );
      case AppMode.PART_1:
        return (
          <div className={baseClasses}>
            <IconBox><LightbulbIcon /></IconBox>
            <RightArrow />
            <IconBox><WordIcon /></IconBox>
            <span className="text-sm font-black text-gray-700 uppercase tracking-widest ml-2">Step 1: Create Draft Rubric</span>
          </div>
        );
      case AppMode.PART_2:
        return (
          <div className={baseClasses}>
            <IconBox><WordIcon /></IconBox>
            <RightArrow />
            <IconBox><CSVIcon /></IconBox>
            <span className="text-sm font-black text-gray-700 uppercase tracking-widest ml-2">Step 2: Convert to CSV</span>
          </div>
        );
      case AppMode.PART_3:
        return (
          <div className={baseClasses}>
            <IconBox><CanvasLogo /></IconBox>
            <span className="text-sm font-black text-gray-700 uppercase tracking-widest ml-2">Step 3: Upload to Canvas</span>
          </div>
        );
      case AppMode.SCREENSHOT:
        return (
          <div className={baseClasses}>
            <IconBox><CameraIcon /></IconBox>
            <span className="text-sm font-black text-gray-700 uppercase tracking-widest ml-2">Convert Screenshot</span>
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
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-md">
            <svg className="w-6 h-6 text-[#0033a0]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 100 2v10a2 2 0 01-2 2 1 1 0 100 2h12a2 2 0 01-2 2 1 1 0 100-2v-10a2 2 0 012-2 1 1 0 100-2H4zm3 4a1 1 0 000 2h6a1 1 0 000-2H7z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black">Canvas Rubric Creator</h1>
            <p className="text-xs text-blue-100">All-in-one rubric workflow</p>
          </div>
        </div>
      </div>

      {/* White Ribbon Bar */}
      <div className="bg-white border-b border-gray-200 py-3 px-8 sm:px-12 flex items-center justify-between shadow-sm z-40">
        {/* Left Side: Workflow Sequence */}
        <div className="hidden sm:flex">
          {getRibbonContent()}
        </div>

        {/* Right Side: Help & Return Button */}
        <div className="flex items-center gap-6 ml-auto">
          <button
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-all font-bold text-sm border border-gray-200 active:scale-95"
          >
            <HelpCircle className="w-5 h-5" />
            <span>Help</span>
          </button>

          {showReturnButton && (
            <button
              onClick={() => setCurrentStep(AppMode.DASHBOARD)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all flex items-center gap-2"
            >
              <ChevronRight className="w-4 h-4" />
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
