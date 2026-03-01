
import React, { useState } from 'react';

interface HelpCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

const GEMINI_API_KEY_PROMPT =
  'How do I generate a free Gemini API key in Google AI Studio at aistudio.google.com? Walk me through every step.';

const HelpCenter: React.FC<HelpCenterProps> = ({ isOpen, onClose }) => {
  const [promptCopied, setPromptCopied] = useState(false);

  const handleAskGeminiAboutApiKey = () => {
    window.open('https://gemini.google.com/app', '_blank', 'noopener,noreferrer');
    navigator.clipboard.writeText(GEMINI_API_KEY_PROMPT).then(() => {
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 4000);
    });
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60] transition-opacity"
          onClick={onClose}
        />
      )}
      
      {/* Side Panel */}
      <aside 
        className={`fixed top-0 right-0 h-full w-full sm:w-[400px] bg-white shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        } overflow-y-auto`}
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight uppercase">Help Center</h2>
            <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Instructional Design Toolkit</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-8">

          {/* AI Setup Section */}
          <section>
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">AI Setup</h3>
            <button
              onClick={handleAskGeminiAboutApiKey}
              className="w-full flex items-start justify-between p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-300 rounded-2xl transition-all group text-left"
            >
              <div className="flex-1 pr-3">
                <span className="text-sm font-bold text-blue-900 group-hover:text-blue-700 block">
                  How To Get a Gemini API Key
                </span>
                {promptCopied && (
                  <span className="text-xs text-green-600 font-semibold mt-0.5 block">
                    ✓ Question copied! Just paste it into the Gemini tab.
                  </span>
                )}
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-400 group-hover:text-blue-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>

            <a
              href="https://docs.google.com/document/d/1Ce1gOTozOD3TGd8ntPz3oEWJjU-Y07K2akuIJHXnzHk/edit?tab=t.0"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
            >
              <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">What Is a Gemini API Key and Why Do I Need One?</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 group-hover:text-blue-500 flex-shrink-0 ml-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </section>

          {/* Documentation Section */}
          <section>
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Resources & Training</h3>
            <div className="space-y-3">
              <a 
                href="https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
              >
                <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">How To Generate an Access Token in Canvas</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>

              <a 
                href="https://drive.google.com/drive/folders/1JHSAm6uXphyZSx6I3hUT70l-IwW6T4FK?usp=sharing" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
              >
                <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">Selected Training Documents</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>

              <a 
                href="https://docs.google.com/document/d/1vPzRVs-qdIwhOR_IkFEjZlKw-pobiRYGZgjQm8eUZCY/edit?usp=sharing" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
              >
                <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">How To Manually Upload a Rubric CSV File To Canvas</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </section>

          {/* Contact Support */}
          <section className="pt-8 border-t border-gray-100">
            <div className="text-center">
              <p className="text-[10px] font-bold text-gray-400 mb-4 uppercase tracking-widest">Find bugs? Have improvement requests?</p>
              <button 
                className="w-full py-4 bg-[#0033a0] text-white rounded-2xl font-black uppercase tracking-widest text-sm opacity-50 cursor-not-allowed shadow-lg"
                disabled
              >
                Contact ID Toolkit (Coming Soon)
              </button>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
};

export default HelpCenter;
