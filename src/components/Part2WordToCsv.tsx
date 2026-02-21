import React, { useState, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, Attachment, RubricMeta } from '../types';
import { extractRubricMetadata, sendMessageToGemini } from '../services/geminiService';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { Upload, Download, Loader2, Copy, Check } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

export const Part2WordToCsv: React.FC = () => {
  const {
    state,
    setCurrentStep,
    setCsvOutput,
    setIsLoading,
    setError,
    startProgress,
    stopProgress,
    setProgress,
    getAbortSignal,
  } = useSession();

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [rubricOptions, setRubricOptions] = useState<RubricMeta[]>([]);
  const [selectedRubric, setSelectedRubric] = useState<number | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = async (file: File) => {
    setError(null);
    setIsLoading(true);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const fileData = event.target?.result;
          if (!fileData) throw new Error('Failed to read file');

          let mimeType = 'application/octet-stream';
          let base64Data = '';

          if (file.name.endsWith('.pdf')) {
            mimeType = 'application/pdf';
            const arrayBuffer = fileData as ArrayBuffer;
            base64Data = btoa(
              String.fromCharCode.apply(null, Array.from(new Uint8Array(arrayBuffer)))
            );
          } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
            mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const arrayBuffer = fileData as ArrayBuffer;
            base64Data = btoa(
              String.fromCharCode.apply(null, Array.from(new Uint8Array(arrayBuffer)))
            );
          } else {
            throw new Error('Please upload a Word (.docx) or PDF file');
          }

          const attachment: Attachment = {
            name: file.name,
            mimeType,
            data: base64Data,
          };

          setAttachments([attachment]);

          // Analyze for rubrics
          setAnalyzing(true);
          const rubrics = await extractRubricMetadata([attachment]);
          setRubricOptions(rubrics);

          if (rubrics.length === 0) {
            setError('No rubric found in the file. Please ensure it contains a rubric table.');
          } else if (rubrics.length === 1) {
            setSelectedRubric(0);
          }
        } catch (err: any) {
          setError(`Error processing file: ${err.message}`);
        } finally {
          setAnalyzing(false);
          setIsLoading(false);
        }
      };

      if (file.name.endsWith('.pdf') || file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        reader.readAsArrayBuffer(file);
      } else {
        setError('Unsupported file type');
        setIsLoading(false);
      }
    } catch (err: any) {
      setError(`Failed to process file: ${err.message}`);
      setIsLoading(false);
    }
  };

  const handleGenerateCsv = async () => {
    if (selectedRubric === null) {
      setError('Please select a rubric');
      return;
    }

    if (attachments.length === 0) {
      setError('No file selected');
      return;
    }

    setIsLoading(true);
    setError(null);

    startProgress(1, true);
    setProgress({ currentStep: 'Reading document...' });

    try {
      const signal = getAbortSignal();

      setProgress({ currentStep: 'Analyzing rubric structure...', percentage: 0.2 });
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (signal.aborted) {
        setError('CSV conversion cancelled');
        return;
      }

      const rubric = rubricOptions[selectedRubric];
      const prompt = `Extract the rubric named "${rubric.name}" from the attached document and convert it to a Canvas-compatible CSV format. The CSV MUST include:\n1. Header row with exact Canvas headers\n2. One row per criterion\n3. Ratings ordered from highest to lowest points\n4. All point values included\n\nReturn ONLY the CSV format, wrapped in a \`\`\`csv\n\`\`\` code block.`;

      setProgress({
        currentStep: 'Generating CSV format...',
        percentage: 0.5,
      });

      const response = await sendMessageToGemini(prompt, attachments);

      if (signal.aborted) {
        setError('CSV conversion cancelled');
        return;
      }

      // Extract CSV from code block if present
      let csvData = response;
      const codeBlockMatch = response.match(/```csv\n([\s\S]*?)\n```/);
      if (codeBlockMatch) {
        csvData = codeBlockMatch[1];
      }

      setProgress({
        currentStep: 'Formatting CSV...',
        percentage: 0.9,
      });

      setCsvContent(csvData);
      setCsvOutput(csvData, `${rubric.name}.csv`);

      setProgress({ percentage: 1, itemsProcessed: 1 });
    } catch (err: any) {
      if (!getAbortSignal().aborted) {
        setError(`Failed to convert to CSV: ${err.message}`);
      }
    } finally {
      setIsLoading(false);
      stopProgress();
    }
  };

  const handleCopyToClipboard = () => {
    if (csvContent) {
      navigator.clipboard.writeText(csvContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadCsv = () => {
    if (csvContent) {
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rubric-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleContinuePart3 = () => {
    if (!csvContent) {
      setError('Please generate CSV first');
      return;
    }
    setCurrentStep(AppMode.PART_3);
  };

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full">
        <h2 className="text-2xl font-black text-gray-900 mb-2">Convert to CSV</h2>
        <p className="text-gray-600 font-medium mb-8">
          Upload a Word or PDF file with your rubric
        </p>

        {!csvContent ? (
          <>
            {/* File Upload */}
            {attachments.length === 0 ? (
              <>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative w-full p-8 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
                    isDragging
                      ? 'bg-blue-50 border-blue-400'
                      : 'bg-gray-50 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <Upload className="w-8 h-8 text-gray-400" />
                  <p className="text-sm font-bold text-gray-700">
                    Drop Word or PDF file here
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.doc"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleFileSelect(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                </div>
              </>
            ) : (
              <>
                {/* File Selected */}
                <div className="p-4 bg-green-50 border border-green-200 rounded-2xl mb-6">
                  <p className="text-sm font-bold text-green-900">
                    ✓ {attachments[0].name}
                  </p>
                </div>

                {/* Rubric Selection */}
                {rubricOptions.length > 0 && (
                  <div className="mb-6">
                    <label className="block text-sm font-bold text-gray-700 mb-3">
                      Select Rubric to Convert
                    </label>
                    <div className="space-y-2">
                      {rubricOptions.map((rubric, i) => (
                        <label key={i} className="flex items-center p-3 border rounded-xl cursor-pointer hover:bg-blue-50">
                          <input
                            type="radio"
                            checked={selectedRubric === i}
                            onChange={() => setSelectedRubric(i)}
                            className="w-4 h-4"
                          />
                          <span className="ml-3 font-bold text-gray-900">{rubric.name}</span>
                          <span className="ml-auto text-xs text-gray-600">{rubric.totalPoints} points</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {state.error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mb-6">
                    <p className="text-sm text-red-700 font-bold">{state.error}</p>
                  </div>
                )}

                {/* Generate CSV Button */}
                <button
                  onClick={handleGenerateCsv}
                  disabled={analyzing || selectedRubric === null}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2"
                >
                  {analyzing && <Loader2 className="w-5 h-5 animate-spin" />}
                  {analyzing ? 'Converting...' : 'Generate CSV'}
                </button>

                {/* Clear Button */}
                <button
                  onClick={() => {
                    setAttachments([]);
                    setRubricOptions([]);
                    setSelectedRubric(null);
                    setError(null);
                  }}
                  className="w-full mt-3 py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all"
                >
                  Choose Different File
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {/* Display CSV */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Generated CSV
              </label>
              <div className="p-4 bg-gray-50 border rounded-2xl max-h-48 overflow-auto">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-mono">
                  {csvContent}
                </pre>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleCopyToClipboard}
                className="flex-1 px-4 py-3 bg-gray-600 text-white rounded-xl font-bold hover:bg-gray-700 transition-all flex items-center justify-center gap-2"
              >
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleDownloadCsv}
                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Download
              </button>
              <button
                onClick={handleContinuePart3}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all"
              >
                Continue to Part 3
              </button>
            </div>

            <button
              onClick={() => {
                setCsvContent(null);
                setAttachments([]);
                setRubricOptions([]);
                setSelectedRubric(null);
              }}
              className="w-full mt-3 py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all"
            >
              Convert Another File
            </button>
          </>
        )}
      </div>
    </div>
  );
};
