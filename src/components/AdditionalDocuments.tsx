import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, Trash2, Eye, Plus, ExternalLink, Shield, Award } from 'lucide-react';
import { uploadApplicationAdditionalFile, insertApplicationAdditional, getApplicationAdditionalByApplicationId, type ApplicationAdditionalRow } from '../lib/supabase';

type Props = {
  onContinue: () => void;
  onBack?: () => void;
  loading?: boolean;
  applicationId?: string;
};

type DocumentFile = {
  id: string;
  file: File;
  status: 'uploading' | 'completed' | 'error';
  uploadProgress?: number;
};

const AdditionalDocuments: React.FC<Props> = ({ onContinue, onBack, loading, applicationId }) => {
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savedDocs, setSavedDocs] = useState<ApplicationAdditionalRow[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  React.useEffect(() => {
    const run = async () => {
      if (!applicationId) return;
      setLoadingSaved(true);
      try {
        const rows = await getApplicationAdditionalByApplicationId(applicationId);
        setSavedDocs(rows || []);
      } catch (e) {
        console.warn('Failed to load saved additional documents:', e);
      } finally {
        setLoadingSaved(false);
      }
    };
    run();
  }, [applicationId]);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const newDocs: DocumentFile[] = [];
    Array.from(files).forEach((file, index) => {
      // Accept common document formats
      const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/jpg'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        alert(`File "${file.name}" is not a supported format. Please upload PDF, Word, or image files.`);
        return;
      }
      
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        return;
      }
      
      // Avoid duplicates by name+size
      const duplicate = documents.find(doc => 
        doc.file.name === file.name && doc.file.size === file.size
      );
      if (!duplicate) {
        newDocs.push({
          id: `doc-${Date.now()}-${index}`,
          file,
          status: 'completed',
          uploadProgress: 100
        });
      }
    });
    
    if (newDocs.length > 0) {
      setDocuments(prev => [...prev, ...newDocs]);
    }
  };

  const removeDocument = (id: string) => {
    setDocuments(prev => prev.filter(doc => doc.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleContinue = async () => {
    if (submitting) return;
    if (!applicationId) {
      alert('Missing application ID. Please go back and try again.');
      return;
    }
    setSubmitting(true);
    try {
      // Upload all documents and insert rows into application_additional
      for (const doc of documents) {
        const { publicUrl } = await uploadApplicationAdditionalFile(applicationId, doc.file);
        await insertApplicationAdditional({
          application_id: applicationId,
          file_name: doc.file.name,
          file_size: doc.file.size,
          file_type: doc.file.type,
          file_url: publicUrl ?? undefined,
        });
      }
      // Clear local list after successful save
      setDocuments([]);
      // Refresh saved list so it appears when user returns or if they stay
      try {
        const rows = await getApplicationAdditionalByApplicationId(applicationId);
        setSavedDocs(rows || []);
      } catch (e) {
        console.warn('Failed to refresh saved additional documents:', e);
      }
      
      onContinue();
    } catch (error) {
      console.error('Error processing additional documents:', error);
      alert('Failed to process documents. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) {
      return <FileText className="w-8 h-8 text-red-500" />;
    } else if (fileType.includes('word') || fileType.includes('document')) {
      return <FileText className="w-8 h-8 text-blue-500" />;
    } else if (fileType.includes('image')) {
      return <Eye className="w-8 h-8 text-green-500" />;
    }
    return <FileText className="w-8 h-8 text-gray-500" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ maxWidth: '1200px' }}>
        {/* Enhanced Header with Professional Design */}
        <div className="relative bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 rounded-2xl shadow-2xl overflow-hidden mb-8">
          {/* Background Pattern */}
          <div className="absolute inset-0 bg-black/10"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/90 to-indigo-800/90"></div>
          
          {/* Content */}
          <div className="relative px-8 py-12 sm:px-12">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold text-white leading-tight">Additional Documents</h1>
                <p className="text-blue-100 text-lg mt-2">Strengthen your application with supporting materials</p>
              </div>
            </div>
            
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                <div className="flex items-center gap-3">
                  <Award className="w-6 h-6 text-yellow-300" />
                  <div>
                    <p className="text-white font-semibold">Optional Step</p>
                    <p className="text-blue-100 text-sm">Enhance your profile</p>
                  </div>
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                <div className="flex items-center gap-3">
                  <FileText className="w-6 h-6 text-green-300" />
                  <div>
                    <p className="text-white font-semibold">Secure Upload</p>
                    <p className="text-blue-100 text-sm">Bank-grade security</p>
                  </div>
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-6 h-6 text-emerald-300" />
                  <div>
                    <p className="text-white font-semibold">Saved Documents</p>
                    <p className="text-blue-100 text-sm">{savedDocs.length} files stored</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="p-8 sm:p-10">
          {/* Upload Section */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">
              Upload Supporting Documents
            </h3>
            <p className="text-gray-600 mb-6">
              You may upload letters of recommendation, business licenses, contracts, or any other documents 
              that support your application. Accepted formats: PDF, Word documents, and images.
            </p>

            {/* Enhanced Drag & Drop Zone */}
            <div className="relative">
              <div
                className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 ${
                  isDragOver
                    ? 'border-blue-500 bg-gradient-to-br from-blue-50 to-indigo-50 scale-[1.02]'
                    : 'border-gray-300 hover:border-blue-400 hover:bg-gradient-to-br hover:from-gray-50 hover:to-blue-50'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {/* Upload Icon with Animation */}
                <div className={`w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center transition-transform duration-300 ${isDragOver ? 'scale-110' : ''}`}>
                  <Upload className={`w-10 h-10 transition-colors duration-300 ${isDragOver ? 'text-blue-600' : 'text-blue-500'}`} />
                </div>
                
                <h4 className="text-2xl font-bold text-gray-900 mb-3">
                  Drop files here or click to browse
                </h4>
                <p className="text-gray-600 mb-8 max-w-md mx-auto leading-relaxed">
                  Upload PDF documents, Word files, or images up to 10MB each. 
                  Your files are encrypted and securely stored.
                </p>
                
                {/* Enhanced Upload Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold text-lg shadow-lg hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl hover:scale-105 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                  <Plus className="w-5 h-5" />
                  Choose Files
                </button>
                
                {/* Supported Formats */}
                <div className="mt-6 flex items-center justify-center gap-6 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-red-500" />
                    <span>PDF</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <span>Word</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-green-500" />
                    <span>Images</span>
                  </div>
                </div>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  onChange={handleFileSelect}
                  className="sr-only"
                />
              </div>
            </div>
          </div>

          {/* Documents List */}
          {documents.length > 0 && (
            <div className="mb-8">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                Uploaded Documents ({documents.length})
              </h3>
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center gap-4">
                      {getFileIcon(doc.file.type)}
                      <div>
                        <h4 className="font-medium text-gray-900">{doc.file.name}</h4>
                        <p className="text-sm text-gray-500">
                          {formatFileSize(doc.file.size)} • {doc.file.type.split('/')[1].toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.status === 'completed' && (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeDocument(doc.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200"
                        title="Remove document"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Enhanced Saved Documents Section */}
          <div className="mb-10">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900">
                Saved Documents
              </h3>
              <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-50 to-green-50 rounded-full border border-emerald-200">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <span className="text-emerald-700 font-semibold">
                  {loadingSaved ? 'Loading...' : `${savedDocs.length} files stored`}
                </span>
              </div>
            </div>
            
            {savedDocs.length === 0 && !loadingSaved ? (
              <div className="relative p-12 border-2 border-dashed border-gray-200 rounded-2xl bg-gradient-to-br from-gray-50 to-slate-50 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-gray-400" />
                </div>
                <h4 className="text-lg font-semibold text-gray-900 mb-2">No documents saved yet</h4>
                <p className="text-gray-500 max-w-sm mx-auto">
                  Upload supporting documents above to strengthen your application and they'll appear here.
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {savedDocs.map((row, index) => (
                  <div
                    key={row.id || `${row.file_name}-${row.created_at}`}
                    className="group relative bg-gradient-to-r from-white to-gray-50 rounded-xl border border-gray-200 p-6 hover:shadow-lg hover:border-blue-300 transition-all duration-200"
                  >
                    {/* File Number Badge */}
                    <div className="absolute -top-2 -left-2 w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full flex items-center justify-center text-sm font-bold shadow-lg">
                      {index + 1}
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center">
                          {getFileIcon(String(row.file_type || 'application/pdf'))}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-900 text-lg">{row.file_name}</h4>
                          <div className="flex items-center gap-3 mt-1">
                            {row.file_size && (
                              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md font-medium">
                                {formatFileSize(Number(row.file_size))}
                              </span>
                            )}
                            {row.file_type && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-md font-medium">
                                {String(row.file_type).split('/').pop()?.toUpperCase()}
                              </span>
                            )}
                            <span className="text-gray-500 text-sm">
                              Uploaded {row.created_at ? new Date(row.created_at).toLocaleDateString() : 'recently'}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        {row.file_url ? (
                          <a
                            href={row.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Open
                          </a>
                        ) : (
                          <div className="px-4 py-2 bg-gray-100 text-gray-500 rounded-lg">
                            No preview
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Enhanced Information Box */}
          <div className="relative bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border border-blue-200 rounded-2xl p-8 mb-10 overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-5">
              <div className="absolute top-4 right-4 w-32 h-32 bg-blue-600 rounded-full"></div>
              <div className="absolute bottom-4 left-4 w-24 h-24 bg-indigo-600 rounded-full"></div>
            </div>
            
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                  <Award className="w-6 h-6 text-white" />
                </div>
                <h4 className="text-xl font-bold text-blue-900">Strengthen Your Application</h4>
              </div>
              
              <p className="text-blue-800 mb-6 leading-relaxed">
                This step is optional but recommended. Adding supporting documents can significantly improve your approval chances and potentially secure better terms.
              </p>
              
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <h5 className="font-semibold text-blue-900 mb-3">Recommended Documents:</h5>
                  <ul className="space-y-2 text-blue-800">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      Business licenses and permits
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      Letters of recommendation
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      Contracts or purchase orders
                    </li>
                  </ul>
                </div>
                <div>
                  <h5 className="font-semibold text-blue-900 mb-3">Additional Options:</h5>
                  <ul className="space-y-2 text-blue-800">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      Financial statements
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      Tax returns
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      Other business documents
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Enhanced Navigation Buttons */}
          <div className="flex items-center justify-between pt-8 border-t border-gray-200">
            <button
              type="button"
              onClick={onBack}
              disabled={submitting}
              className="inline-flex items-center gap-3 px-6 py-3 text-gray-700 bg-white border-2 border-gray-300 rounded-xl font-semibold hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-4 focus:ring-gray-500/20"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
              </svg>
              Back to Bank Statement
            </button>

            <button
              type="button"
              onClick={handleContinue}
              disabled={submitting || loading}
              className={`inline-flex items-center gap-3 px-8 py-4 rounded-xl font-bold text-lg shadow-lg transition-all duration-200 focus:outline-none focus:ring-4 ${
                submitting || loading
                  ? 'bg-gradient-to-r from-gray-300 to-gray-400 text-white cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl hover:scale-105 focus:ring-blue-500/30'
              }`}
            >
              {submitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing Documents…
                </>
              ) : (
                <>
                  Continue to Lender Matches
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};

export default AdditionalDocuments;
