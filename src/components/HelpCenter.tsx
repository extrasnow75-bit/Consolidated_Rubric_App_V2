
import React, { useEffect, useRef } from 'react';

interface HelpCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const HelpCenter: React.FC<HelpCenterProps> = ({ isOpen, onClose }) => {
  const panelRef = useRef<HTMLElement>(null);

  // Listen for deeplink events from other components (e.g. "How do I get one?" link)
  useEffect(() => {
    const handler = (e: Event) => {
      const sectionId = (e as CustomEvent).detail as string;
      // Wait for the slide-in animation to complete before scrolling
      setTimeout(() => {
        const target = document.getElementById(sectionId);
        if (target && panelRef.current) {
          panelRef.current.scrollTo({ top: target.offsetTop - 80, behavior: 'smooth' });
        }
      }, 350);
    };
    window.addEventListener('openHelpSection', handler);
    return () => window.removeEventListener('openHelpSection', handler);
  }, []);

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
        ref={panelRef}
        className={`fixed top-0 right-0 h-full w-full sm:w-[400px] bg-white shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        } overflow-y-auto`}
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight uppercase">Help Center</h2>
            <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">IDS TOOLKIT</p>
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

          {/* AI Setup */}
          <section>
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-3">AI Setup</h3>
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl space-y-3">
              <p className="text-sm font-black text-gray-900">How To Get a Gemini API Key</p>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                <li>Go to <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google AI Studio</a>.</li>
                <li>Sign in with your Google or SSO account, such as your Boise State University email.</li>
                <li>
                  Create the key:
                  <ol className="list-[lower-alpha] list-inside space-y-1 mt-1 ml-4">
                    <li>Click <span className="font-bold">"Get API key"</span> on the left.</li>
                    <li>Click the <span className="font-bold">"Create API key"</span> button.</li>
                  </ol>
                </li>
                <li>Copy and paste the key. A string of letters and numbers will appear. Copy it immediately.</li>
                <li>Use it: Go back to your app and paste it into the appropriate place.</li>
              </ol>
              <p className="text-xs text-gray-500">
                Source:{' '}
                <a
                  href="https://docs.google.com/document/d/1Ce1gOTozOD3TGd8ntPz3oEWJjU-Y07K2akuIJHXnzHk/edit?tab=t.0#heading=h.xaazhwt982j4"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  What a Gemini API Key Is, and How and Why to Get One
                </a>
              </p>
            </div>
          </section>

          {/* Canvas Access Token — inline steps */}
          <section id="canvas-setup">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Canvas Setup</h3>
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl space-y-3">
              <p className="text-sm font-black text-gray-900">How to Generate a Canvas Access Token</p>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                <li>Log into Canvas.</li>
                <li>Go to <span className="font-bold">Account → Settings</span>.</li>
                <li>Scroll to <span className="font-bold">Approved Integrations</span>.</li>
                <li>Click <span className="font-bold">+ New Access Token</span>.</li>
                <li>Give it a name and click <span className="font-bold">Generate Token</span>.</li>
                <li>Copy the token and paste it into the app.</li>
              </ol>
              <p className="text-xs text-gray-500">
                Source:{' '}
                <a
                  href="https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  How do I manage API access tokens in my user account?
                </a>
              </p>
            </div>
          </section>

          {/* Resources & Training */}
          <section>
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Resources & Training</h3>
            <div className="space-y-3">
              <a
                href="https://drive.google.com/drive/folders/1JHSAm6uXphyZSx6I3hUT70l-IwW6T4FK?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
              >
                <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">Selected Training Documents</span>
                <span className="text-gray-400 group-hover:text-blue-500 ml-3"><ExternalLinkIcon /></span>
              </a>

              <a
                href="https://docs.google.com/document/d/1vPzRVs-qdIwhOR_IkFEjZlKw-pobiRYGZgjQm8eUZCY/edit?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
              >
                <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">How To Manually Upload a Rubric CSV File To Canvas</span>
                <span className="text-gray-400 group-hover:text-blue-500 ml-3"><ExternalLinkIcon /></span>
              </a>
            </div>
          </section>

          {/* App Suggestions */}
          <section className="pt-8 border-t border-gray-100">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Find bugs? Have improvement requests?</h3>
            <a
              href="https://docs.google.com/document/d/1UALeUcbTKGx6ytt7tY4aCqja28rvRdIR-tW8nGYhFn8/edit?tab=t.0"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
            >
              <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">App Suggestions Document</span>
              <span className="text-gray-400 group-hover:text-blue-500 ml-3"><ExternalLinkIcon /></span>
            </a>
          </section>

          {/* AI Models Used */}
          <section className="pt-4">
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
              <p className="text-sm font-black text-gray-900 flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                AI Models Used
              </p>
              <ul className="space-y-1 text-sm text-gray-600 ml-6">
                <li><span className="font-semibold text-gray-700">Rubric generation:</span> gemini-2.5-flash</li>
                <li><span className="font-semibold text-gray-700">CSV conversion:</span> gemini-2.5-flash-lite</li>
              </ul>
            </div>
          </section>

        </div>
      </aside>
    </>
  );
};

export default HelpCenter;
