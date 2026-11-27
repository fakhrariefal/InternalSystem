import React from 'react';
import { Button } from './ui/primitives';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || 'Terjadi kesalahan sistem.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-lg w-full rounded-lg border border-red-200 bg-white p-6 space-y-4">
            <h1 className="text-lg font-semibold text-red-700">
              Terjadi Gangguan Sistem
            </h1>
            <p className="text-sm text-slate-600 break-words">
              {this.state.errorMessage}
            </p>
            <Button
              variant="default"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
            >
              Muat Ulang Aplikasi
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
