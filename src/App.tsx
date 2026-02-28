import React, { useEffect, useState } from 'react';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Part1Rubric } from './components/Part1Rubric';
import { Part2WordToCsv } from './components/Part2WordToCsv';
import { Part3Upload } from './components/Part3Upload';
import { ScreenshotConverter } from './components/ScreenshotConverter';
import HelpCenter from './components/HelpCenter';
import ProgressDisplay from './components/ProgressDisplay';
import TaskCompletionDialog from './components/TaskCompletionDialog';
import GoogleAuthCallback from './components/GoogleAuthCallback';
import { AppMode } from './types';

const AppContent: React.FC = () => {
  const {
    state,
    setHelpOpen,
    setTaskCompletionOpen,
    setCurrentStep,
    newBatch,
    clearSession,
    stopProgress,
  } = useSession();

  // Check if this is an OAuth callback
  const [isOAuthCallback, setIsOAuthCallback] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (code || state || error) {
      setIsOAuthCallback(true);
    }
  }, []);

  // If this is an OAuth callback, show the callback component
  if (isOAuthCallback) {
    return <GoogleAuthCallback onComplete={() => setIsOAuthCallback(false)} />;
  }

  const renderContent = () => {
    switch (state.currentStep) {
      case AppMode.DASHBOARD:
        return <Dashboard />;
      case AppMode.PART_1:
        return <Part1Rubric />;
      case AppMode.PART_2:
        return <Part2WordToCsv />;
      case AppMode.PART_3:
        return <Part3Upload />;
      case AppMode.SCREENSHOT:
        return <ScreenshotConverter />;
      default:
        return <Dashboard />;
    }
  };

  const handleTaskContinue = () => {
    setTaskCompletionOpen(false);
    if (state.currentStep === AppMode.PART_1) {
      setCurrentStep(AppMode.PART_2);
    } else if (state.currentStep === AppMode.PART_2) {
      setCurrentStep(AppMode.PART_3);
    }
  };

  const handleNewBatch = () => {
    setTaskCompletionOpen(false);
    newBatch();
    if (state.currentStep === AppMode.PART_1 || state.currentStep === AppMode.SCREENSHOT) {
      // Stay in Part 1 or Screenshot for new batch
    } else if (state.currentStep === AppMode.PART_2) {
      setCurrentStep(AppMode.PART_1);
    } else if (state.currentStep === AppMode.PART_3) {
      setCurrentStep(AppMode.PART_2);
    }
  };

  const handleNewSession = () => {
    setTaskCompletionOpen(false);
    clearSession();
    setCurrentStep(AppMode.DASHBOARD);
  };

  return (
    <>
      <Layout>
        {renderContent()}
        <HelpCenter isOpen={state.helpOpen} onClose={() => setHelpOpen(false)} />
      </Layout>
      <ProgressDisplay progress={state.progress} onStop={stopProgress} />
      <TaskCompletionDialog
        isOpen={state.taskCompletionOpen}
        currentStep={state.currentStep}
        onContinue={handleTaskContinue}
        onNewBatch={handleNewBatch}
        onNewSession={handleNewSession}
      />
    </>
  );
};

const App: React.FC = () => {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  );
};

export default App;
