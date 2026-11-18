import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorPage } from './ErrorPage';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught UI ErrorBoundary:', error, info);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorPage
          code={500}
          customMessage="Terjadi kesalahan tampilan tak terduga di browser. Silakan muat ulang halaman atau kembali ke beranda."
          onRetry={() => {
            this.setState({ hasError: false });
            window.location.reload();
          }}
        />
      );
    }
    return this.props.children;
  }
}
