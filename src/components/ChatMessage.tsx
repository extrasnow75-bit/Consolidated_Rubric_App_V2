
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Message, Role } from '../types';

interface ChatMessageProps {
  message: Message;
}

const CodeBlock = ({ className, children, filename, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const isCSV = language === 'csv';
  const content = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    // Use the provided filename or fallback to default
    const downloadName = filename ? (filename.endsWith('.csv') ? filename : `${filename}.csv`) : 'canvas_rubric_template.csv';
    
    link.setAttribute('href', url);
    link.setAttribute('download', downloadName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="my-8 rounded-2xl overflow-hidden border border-gray-200 shadow-lg bg-gray-50 transition-all hover:shadow-xl">
      <div className="flex flex-wrap items-center justify-between px-5 py-3 bg-gray-100 border-b border-gray-200 gap-3">
        <span className="text-xs font-black text-gray-500 uppercase tracking-[0.2em]">{language || 'text'} content</span>
        <div className="flex flex-wrap items-center gap-2">
          {isCSV && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 text-xs font-bold text-blue-700 hover:text-white hover:bg-blue-600 transition-all bg-white border border-blue-200 rounded-lg px-4 py-2 shadow-sm active:scale-95"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Download CSV</span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-2 text-xs font-bold text-gray-700 hover:text-blue-700 transition-all bg-white border border-gray-300 rounded-lg px-4 py-2 shadow-sm active:scale-95"
          >
            {copied ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-green-600">Copied!</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 012-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      
      <div className="overflow-x-auto bg-slate-900 p-6">
        <code className={`${className} text-blue-50 font-mono text-[13px] leading-loose block whitespace-pre`} {...props}>
          {children}
        </code>
      </div>
    </div>
  );
};

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === Role.USER;

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-10 animate-in fade-in slide-in-from-bottom-4 duration-500`}>
      <div
        className={`max-w-[90%] sm:max-w-[85%] rounded-[2rem] px-7 py-6 shadow-xl border ${
          isUser
            ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white border-blue-500 rounded-br-none'
            : 'bg-white text-gray-800 border-gray-100 rounded-bl-none'
        }`}
      >
        <div className={`prose ${isUser ? 'prose-invert' : 'prose-slate'} max-w-none text-[16px] leading-[1.8]`}>
          <ReactMarkdown
             components={{
                code({node, className, children, ...props}: any) {
                  const match = /language-(\w+)/.exec(className || '')
                  const isInline = !match && !String(children).includes('\n');
                  return !isInline ? (
                    <CodeBlock className={className} filename={message.metadata?.filename} {...props}>
                        {children}
                    </CodeBlock>
                  ) : (
                    <code className="bg-slate-200/60 px-2 py-1 rounded-md font-mono text-xs font-bold text-blue-800" {...props}>
                      {children}
                    </code>
                  )
                },
                a: ({node, children, ...props}: any) => (
                  <a 
                    className={`${isUser ? 'text-white underline decoration-white/50' : 'text-blue-600 underline decoration-blue-300'} font-bold hover:opacity-80 transition-all`}
                    target="_blank"
                    rel="noopener noreferrer"
                    {...props}
                  >
                    {children}
                  </a>
                ),
                p: ({children}) => <p className="mb-6 last:mb-0">{children}</p>,
                li: ({children}) => <li className="mb-4 last:mb-0">{children}</li>,
                ul: ({children}) => <ul className="mb-8 list-disc pl-6 space-y-2">{children}</ul>,
                ol: ({children}) => <ol className="mb-8 list-decimal pl-6 space-y-2">{children}</ol>,
                strong: ({children}) => <strong className="font-black text-inherit underline-offset-4 decoration-blue-500/30 decoration-2">{children}</strong>,
                h1: ({children}) => <h1 className="text-3xl font-black mb-8 mt-10 tracking-tight text-inherit uppercase">{children}</h1>,
                h2: ({children}) => <h2 className="text-2xl font-black mb-6 mt-8 tracking-tight text-inherit">{children}</h2>,
                h3: ({children}) => <h3 className="text-xl font-black mb-5 mt-7 tracking-tight text-inherit">{children}</h3>,
              }}
          >
            {message.text}
          </ReactMarkdown>
        </div>
        
        {message.attachments && message.attachments.length > 0 && (
            <div className={`mt-8 pt-6 border-t ${isUser ? 'border-white/20' : 'border-gray-100'} text-xs`}>
                <p className="font-black mb-3 uppercase tracking-[0.2em] opacity-60">Attached Artifacts</p>
                <div className="flex flex-wrap gap-2">
                    {message.attachments.map((att, idx) => (
                        <span key={idx} className={`inline-flex items-center px-4 py-2 rounded-xl font-bold shadow-sm transition-all hover:scale-105 ${isUser ? 'bg-white/10 text-white backdrop-blur-md' : 'bg-blue-50 text-blue-700'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            {att.name}
                        </span>
                    ))}
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
