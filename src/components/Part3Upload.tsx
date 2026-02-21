import React, { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, CanvasConfig } from '../types';
import { pushRubricToCanvas } from '../services/canvasService';
import { Eye, EyeOff, Loader2, Upload, CheckCircle, AlertCircle, X } from 'lucide-react';
import JSZip from 'jszip';

interface BatchFile {
  id: string;
  name: string;
  content: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message?: string;
}

export const Part3Upload: React.FC = () => {
  const { state, setCsvOutput, setCanvasConfig, setError, setIsLoading, addToHistory } = useSession();

  const [courseUrl, setCourseUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [manualCsv, setManualCsv] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [uploadMode, setUploadMode] = useState<'single' | 'batch'>('single');

  const csvToUse = state.csvOutput || manualCsv;

  // Handle file selection (CSV or ZIP)
  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;

    const newBatchFiles: BatchFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.name.endsWith('.zip')) {
        // Extract CSV files from ZIP
        try {
          const zip = new JSZip();
          const zipContent = await zip.loadAsync(file);

          for (const [fileName, fileObj] of Object.entries(zipContent.files)) {
            if (fileName.endsWith('.csv') && !fileObj.dir) {
              const csvContent = await fileObj.async('string');
              newBatchFiles.push({
                id: `${Date.now()}-${Math.random()}`,
                name: fileName,
                content: csvContent,
                status: 'pending',
              });
            }
          }
        } catch (err: any) {
          setError(`Failed to extract ZIP file: ${err.message}`);
        }
      } else if (file.name.endsWith('.csv')) {
        // Read CSV file directly
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          newBatchFiles.push({
            id: `${Date.now()}-${Math.random()}`,
            name: file.name,
            content,
            status: 'pending',
          });
        };
        reader.readAsText(file);
      }
    }

    // Wait for all file reads to complete
    setTimeout(() => {
      setBatchFiles((prev) => [...prev, ...newBatchFiles]);
      setUploadMode('batch');
    }, 100);
  };

  const handleUpload = async () => {
    if (!courseUrl.trim() || !accessToken.trim()) {
      setError('Please enter Canvas URL and access token');
      return;
    }

    if (uploadMode === 'single' && !csvToUse.trim()) {
      setError('No CSV content to upload');
      return;
    }

    if (uploadMode === 'batch' && batchFiles.length === 0) {
      setError('No CSV files to upload');
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadStatus(null);

    const config: CanvasConfig = {
      courseHomeUrl: courseUrl,
      accessToken: accessToken,
    };

    try {
      if (uploadMode === 'single') {
        // Single upload
        const result = await pushRubricToCanvas(config, csvToUse);
        setUploadStatus(result);

        if (result.success) {
          setCanvasConfig(config);
          addToHistory({
            id: Date.now().toString(),
            timestamp: Date.now(),
            rubricName: 'Uploaded Rubric',
            totalPoints: parseInt(state.rubricMetadata?.totalPoints || '0') || 100,
            csvFileName: state.csvFileName || 'rubric.csv',
            canvasUploadStatus: 'success',
          });
        }
      } else {
        // Batch upload
        const updatedFiles = [...batchFiles];
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < updatedFiles.length; i++) {
          const file = updatedFiles[i];
          updatedFiles[i] = { ...file, status: 'uploading' };
          setBatchFiles([...updatedFiles]);

          try {
            const result = await pushRubricToCanvas(config, file.content);

            if (result.success) {
              updatedFiles[i] = {
                ...file,
                status: 'success',
                message: 'Successfully uploaded',
              };
              successCount++;

              addToHistory({
                id: Date.now().toString(),
                timestamp: Date.now(),
                rubricName: file.name.replace('.csv', ''),
                totalPoints: 100,
                csvFileName: file.name,
                canvasUploadStatus: 'success',
              });
            } else {
              updatedFiles[i] = {
                ...file,
                status: 'error',
                message: result.message,
              };
              errorCount++;
            }
          } catch (err: any) {
            updatedFiles[i] = {
              ...file,
              status: 'error',
              message: err.message,
            };
            errorCount++;
          }

          setBatchFiles([...updatedFiles]);
        }

        setUploadStatus({
          success: errorCount === 0,
          message: `Batch upload complete: ${successCount} successful, ${errorCount} failed`,
        });
      }
    } catch (err: any) {
      setUploadStatus({
        success: false,
        message: `Upload failed: ${err.message}`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeBatchFile = (id: string) => {
    setBatchFiles((prev) => prev.filter((f) => f.id !== id));
    if (batchFiles.length === 1) {
      setUploadMode('single');
    }
  };

  const clearBatchFiles = () => {
    setBatchFiles([]);
    setUploadMode('single');
  };

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-3xl w-full">
        <h2 className="text-2xl font-black text-gray-900 mb-2">Upload to Canvas</h2>
        <p className="text-gray-600 font-medium mb-6">
          {uploadMode === 'single'
            ? 'Enter your Canvas credentials to upload the rubric'
            : 'Upload multiple CSV files to Canvas LMS'}
        </p>

        {/* Upload Mode Toggle */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={() => {
              setUploadMode('single');
              clearBatchFiles();
            }}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              uploadMode === 'single'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Single Upload
          </button>
          <button
            onClick={() => setUploadMode('batch')}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              uploadMode === 'batch'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Batch Upload
          </button>
        </div>

        {/* CSV Display (Single Mode) */}
        {uploadMode === 'single' && state.csvOutput && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-2xl">
            <p className="text-sm font-bold text-blue-900">
              ✓ CSV file ready ({state.csvFileName || 'rubric.csv'})
            </p>
          </div>
        )}

        {uploadMode === 'single' && !state.csvOutput && !manualCsv && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-2xl">
            <p className="text-sm font-bold text-yellow-900">
              ⚠ No CSV available. You can paste CSV content below or go back to Part 2.
            </p>
          </div>
        )}

        {/* Batch File Upload */}
        {uploadMode === 'batch' && (
          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-700 mb-3">
              Upload CSV Files or ZIP Archive
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center hover:border-blue-400 transition-all cursor-pointer relative">
              <input
                type="file"
                multiple
                accept=".csv,.zip"
                onChange={(e) => handleFileSelect(e.target.files)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-gray-700">
                Drag & drop CSV files or ZIP archive here
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Supports .csv files and .zip archives containing CSV files
              </p>
            </div>

            {/* Batch Files List */}
            {batchFiles.length > 0 && (
              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                {batchFiles.map((file) => (
                  <div
                    key={file.id}
                    className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {file.status === 'success' && (
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                      )}
                      {file.status === 'error' && (
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                      )}
                      {(file.status === 'pending' || file.status === 'uploading') && (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900 truncate">
                          {file.name}
                        </p>
                        {file.message && (
                          <p className="text-xs text-gray-600 truncate">
                            {file.message}
                          </p>
                        )}
                      </div>
                    </div>
                    {file.status === 'pending' && (
                      <button
                        onClick={() => removeBatchFile(file.id)}
                        className="ml-2 text-gray-400 hover:text-red-600 flex-shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {batchFiles.length > 0 && (
              <button
                onClick={clearBatchFiles}
                className="mt-3 text-sm font-bold text-gray-600 hover:text-red-600"
              >
                Clear all files
              </button>
            )}
          </div>
        )}

        {/* Canvas Configuration */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Canvas Course URL
            </label>
            <input
              type="text"
              value={courseUrl}
              onChange={(e) => setCourseUrl(e.target.value)}
              placeholder="https://canvas.yourschool.edu/courses/12345"
              className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Find this in your browser's address bar when viewing a Canvas course
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Canvas API Token
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Paste your Canvas API token here"
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
              >
                {showToken ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Get this from Canvas: Account → Settings → Approved Integrations
            </p>
          </div>
        </div>

        {/* Manual CSV Input (Single Mode) */}
        {uploadMode === 'single' && !state.csvOutput && (
          <div className="mb-6">
            <button
              onClick={() => setShowManualInput(!showManualInput)}
              className="text-sm font-bold text-blue-600 hover:underline"
            >
              {showManualInput ? '▼ Hide CSV Input' : '▶ Paste CSV Manually'}
            </button>
            {showManualInput && (
              <textarea
                value={manualCsv}
                onChange={(e) => setManualCsv(e.target.value)}
                placeholder="Paste your CSV content here..."
                className="w-full h-32 p-3 border rounded-xl mt-3 focus:ring-2 focus:ring-blue-500 outline-none text-xs font-mono"
              />
            )}
          </div>
        )}

        {/* Status Messages */}
        {state.error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mb-6">
            <p className="text-sm text-red-700 font-bold">{state.error}</p>
          </div>
        )}

        {uploadStatus && (
          <div
            className={`p-4 border rounded-2xl mb-6 ${
              uploadStatus.success
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <p
              className={`text-sm font-bold ${
                uploadStatus.success ? 'text-green-900' : 'text-red-900'
              }`}
            >
              {uploadStatus.message}
            </p>
          </div>
        )}

        {/* Upload Button */}
        <button
          onClick={handleUpload}
          disabled={
            isUploading ||
            !courseUrl.trim() ||
            !accessToken.trim() ||
            (uploadMode === 'single' && !csvToUse.trim()) ||
            (uploadMode === 'batch' && batchFiles.length === 0)
          }
          className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2"
        >
          {isUploading && <Loader2 className="w-5 h-5 animate-spin" />}
          {isUploading
            ? uploadMode === 'batch'
              ? 'Uploading Batch...'
              : 'Uploading...'
            : uploadMode === 'batch'
            ? `Upload ${batchFiles.length} File(s)`
            : 'Upload to Canvas'}
        </button>

        {/* Additional Actions */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <button
            onClick={() => {
              setCourseUrl('');
              setAccessToken('');
              setManualCsv('');
              setUploadStatus(null);
              clearBatchFiles();
            }}
            className="px-4 py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all text-sm"
          >
            Clear All
          </button>
          <button
            onClick={() => window.open('https://canvas.instructure.com/doc/api/file.accessing_via_api.html', '_blank')}
            className="px-4 py-2 text-blue-600 rounded-xl font-bold hover:bg-blue-50 transition-all text-sm"
          >
            Canvas Docs
          </button>
        </div>
      </div>
    </div>
  );
};
