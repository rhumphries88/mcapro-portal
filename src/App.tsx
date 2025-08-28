import { useState } from 'react';
import { Building2 } from 'lucide-react';

import SubmissionsPortal from './components/SubmissionsPortal';
import AdminPortal from './components/AdminPortal';
import AllDealsPortal from './components/AllDealsPortal';

function App() {
  const [currentPortal, setCurrentPortal] = useState<'submissions' | 'deals' | 'admin'>('submissions');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Portal Toggle */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 py-4">
            <div className="flex items-center space-x-2">
              <Building2 className="h-8 w-8 text-blue-600" />
              <span className="text-2xl font-bold text-gray-900">MCAPortal Pro</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCurrentPortal('submissions')}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  currentPortal === 'submissions'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Submissions Portal
              </button>
              <button
                onClick={() => setCurrentPortal('deals')}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  currentPortal === 'deals'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All Deals
              </button>
              <button
                onClick={() => setCurrentPortal('admin')}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  currentPortal === 'admin'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Admin Portal
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Portal Content */}
      {currentPortal === 'submissions' && <SubmissionsPortal />}
      {currentPortal === 'deals' && <AllDealsPortal />}
      {currentPortal === 'admin' && <AdminPortal />}
    </div>
  );
}

export default App;