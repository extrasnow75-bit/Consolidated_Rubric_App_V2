import React from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode } from '../types';
import { Lightbulb, FileText, Upload, Camera, ArrowRight } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { state, setCurrentStep, clearSession } = useSession();

  const handleStartPart = (part: AppMode) => {
    setCurrentStep(part);
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="bg-white p-12 rounded-3xl shadow-2xl border border-gray-100 max-w-3xl w-full">
        <div className="mb-8">
          <h2 className="text-3xl font-black text-gray-900 mb-2">Rubric Workflow</h2>
          <p className="text-gray-600 font-medium">Choose how you'd like to work with your rubrics</p>
        </div>

        {/* Main Workflow Steps - Vertical Layout */}
        <div className="space-y-4 mb-6">
          {/* Part 1: Create Draft Rubric */}
          <button
            onClick={() => handleStartPart(AppMode.PART_1)}
            className="w-full p-6 rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all shadow-lg bg-white flex items-start gap-6 group text-left"
          >
            <div className="flex items-center gap-2 pt-1 flex-shrink-0">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-all">
                <Lightbulb className="w-6 h-6 text-amber-600" />
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                <div className="text-blue-600 font-black text-sm">W</div>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-black text-lg text-gray-900">Create Draft Rubric</h3>
              <p className="text-sm text-gray-600 mt-2">Create draft rubric from assignment description</p>
            </div>
          </button>

          {/* Part 2: Convert draft rubric to CSV */}
          <button
            onClick={() => handleStartPart(AppMode.PART_2)}
            className="w-full p-6 rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all shadow-lg bg-white flex items-start gap-6 group text-left"
          >
            <div className="flex items-center gap-2 pt-1 flex-shrink-0">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                <div className="text-blue-600 font-black text-sm">W</div>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-all">
                <div className="text-green-600 font-black text-[10px]">CSV</div>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-black text-lg text-gray-900">Convert draft rubric to CSV</h3>
              <p className="text-sm text-gray-600 mt-2">Transform draft rubric in MS Word format to Canvas-compatible CSV rubric</p>
            </div>
          </button>

          {/* Part 3: Upload to Canvas */}
          <button
            onClick={() => handleStartPart(AppMode.PART_3)}
            className="w-full p-6 rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all shadow-lg bg-white flex items-start gap-6 group text-left"
          >
            <div className="flex items-center gap-2 pt-1 flex-shrink-0">
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-all">
                <div className="text-green-600 font-black text-[10px]">CSV</div>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center group-hover:bg-red-200 transition-all">
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
                  <circle cx="12" cy="12" r="11" fill="#C1272D"/>
                  <path d="M7.5 10 Q 7 10 7 12 Q 7 14 7.5 14 L 14 14 L 14 13 L 8.5 13 Q 8 13 8 12 Q 8 11 8.5 11 L 14 11 L 14 10 Z" fill="white"/>
                </svg>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-black text-lg text-gray-900">Upload to Canvas</h3>
              <p className="text-sm text-gray-600 mt-2">Push CSV rubrics directly to Canvas LMS</p>
            </div>
          </button>

          {/* Screenshot Converter */}
          <button
            onClick={() => handleStartPart(AppMode.SCREENSHOT)}
            className="w-full p-6 rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all shadow-lg bg-white flex items-start gap-6 group text-left"
          >
            <div className="flex items-center gap-2 pt-1 flex-shrink-0">
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-all">
                <Camera className="w-6 h-6 text-purple-600" />
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                <div className="text-blue-600 font-black text-sm">W</div>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-black text-lg text-gray-900">Screenshot to Word Template</h3>
              <p className="text-sm text-gray-600 mt-2">Convert Canvas rubric screenshots to MS Word rubric template</p>
            </div>
          </button>
        </div>

        {/* Session History */}
        {state.uploadHistory.length > 0 && (
          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="font-black text-sm text-gray-700 uppercase tracking-widest mb-4">Recent Activity</h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {state.uploadHistory.slice(0, 5).map((item) => (
                <div key={item.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs">
                  <p className="font-bold text-gray-900">{item.rubricName}</p>
                  <p className="text-gray-600">{item.totalPoints} points • {new Date(item.timestamp).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clear Session Button */}
        <div className="mt-8 pt-8 border-t border-gray-200 flex justify-between">
          <p className="text-xs text-gray-500 flex items-center">
            {state.uploadHistory.length > 0 && `${state.uploadHistory.length} items in history`}
          </p>
          {state.uploadHistory.length > 0 && (
            <button
              onClick={clearSession}
              className="text-xs font-bold text-red-600 hover:text-red-700 uppercase tracking-widest hover:underline"
            >
              Clear Session
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
