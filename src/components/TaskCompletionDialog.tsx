import React from 'react';
import { AppMode } from '../types';
import { CheckCircle, ArrowRight, RotateCw, Home, X } from 'lucide-react';

interface TaskCompletionDialogProps {
  isOpen: boolean;
  currentStep: AppMode;
  onContinue: () => void;
  onNewBatch: () => void;
  onNewSession: () => void;
  onClose: () => void;
  onExport?: () => void;
  onDownload?: () => void;
}

const TaskCompletionDialog: React.FC<TaskCompletionDialogProps> = ({
  isOpen,
  currentStep,
  onContinue,
  onNewBatch,
  onNewSession,
  onClose,
  onExport,
  onDownload,
}) => {
  if (!isOpen) return null;

  const getDialogContent = () => {
    switch (currentStep) {
      case AppMode.PART_1:
        return {
          title: '✓ Draft Rubric Created!',
          message: 'Your draft rubric has been generated successfully.',
          primaryAction: { label: 'Continue to Part 2: Convert to CSV', onClick: onContinue, icon: ArrowRight },
          secondaryActions: [
            { label: 'Download as .docx & Stop', onClick: onExport, icon: 'download' },
            { label: 'Create Another Rubric', onClick: onNewBatch, icon: RotateCw },
            { label: 'Return to Dashboard', onClick: onNewSession, icon: Home },
          ],
        };

      case AppMode.PART_2:
        return {
          title: '✓ CSV File Generated!',
          message: 'Your rubric has been successfully converted to Canvas-compatible CSV format.',
          primaryAction: { label: 'Continue to Part 3: Upload to Canvas', onClick: onContinue, icon: ArrowRight },
          secondaryActions: [
            { label: 'Download CSV & Stop', onClick: onDownload, icon: 'download' },
            { label: 'Convert Another Rubric', onClick: onNewBatch, icon: RotateCw },
            { label: 'Return to Dashboard', onClick: onNewSession, icon: Home },
          ],
        };

      case AppMode.PART_3:
        return {
          title: '✓ Upload Complete!',
          message: 'Your rubric(s) have been successfully uploaded to Canvas.',
          primaryAction: { label: 'Upload More Rubrics (New Batch)', onClick: onNewBatch, icon: RotateCw },
          secondaryActions: [
            { label: 'Start Fresh (New Session)', onClick: onNewSession, icon: 'refresh' },
            { label: 'Return to Dashboard', onClick: onNewSession, icon: Home },
          ],
        };

      default:
        return null;
    }
  };

  const content = getDialogContent();
  if (!content) return null;

  const getIconColor = () => {
    switch (currentStep) {
      case AppMode.PART_1:
        return 'text-amber-500';
      case AppMode.PART_2:
        return 'text-blue-500';
      case AppMode.PART_3:
        return 'text-green-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
      <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <CheckCircle className={`w-16 h-16 ${getIconColor()}`} />
        </div>

        {/* Title */}
        <h2 className="text-2xl font-black text-gray-900 text-center mb-2">{content.title}</h2>

        {/* Message */}
        <p className="text-gray-600 text-center mb-8">{content.message}</p>

        {/* Primary Action Button */}
        <button
          onClick={content.primaryAction.onClick}
          className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all mb-3 flex items-center justify-center gap-2 active:scale-95"
        >
          {content.primaryAction.icon && (
            <content.primaryAction.icon className="w-5 h-5" />
          )}
          {content.primaryAction.label}
        </button>

        {/* Secondary Action Buttons */}
        <div className="space-y-2">
          {content.secondaryActions.map((action, index) => (
            <button
              key={index}
              onClick={action.onClick}
              className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm"
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Workflow Progress Indicator */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center font-bold uppercase tracking-widest mb-3">
            Workflow Progress
          </p>
          <div className="flex gap-2 justify-center">
            {/* Part 1 - Blue */}
            <div
              className={`flex-1 h-2 rounded-full ${
                [AppMode.PART_1, AppMode.PART_2, AppMode.PART_3].includes(currentStep)
                  ? 'bg-blue-500'
                  : 'bg-gray-200'
              }`}
            />
            {/* Part 2 - Green */}
            <div
              className={`flex-1 h-2 rounded-full ${
                [AppMode.PART_2, AppMode.PART_3].includes(currentStep)
                  ? 'bg-green-500'
                  : 'bg-gray-200'
              }`}
            />
            {/* Part 3 - Red */}
            <div
              className={`flex-1 h-2 rounded-full ${
                currentStep === AppMode.PART_3 ? 'bg-red-500' : 'bg-gray-200'
              }`}
            />
          </div>
          <div className="flex gap-2 justify-center mt-2 text-xs text-gray-500">
            <span>Create</span>
            <span>Convert</span>
            <span>Upload</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskCompletionDialog;
