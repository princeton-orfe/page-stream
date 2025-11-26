import React, { useState, useMemo } from 'react';
import { useTemplates, StreamTemplate, TemplateCategory } from '../hooks/useTemplates';
import { StreamFormData, DEFAULT_FORM_DATA } from './StreamForm';

interface Props {
  onSelect: (config: Partial<StreamFormData>) => void;
  onSkip: () => void;
}

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  standard: 'Standard',
  compositor: 'Compositor',
  custom: 'Custom'
};

const CATEGORY_DESCRIPTIONS: Record<TemplateCategory, string> = {
  standard: 'General purpose stream configurations',
  compositor: 'Templates for multi-source compositing',
  custom: 'User-created templates'
};

export function TemplateSelector({ onSelect, onSkip }: Props) {
  const { data, isLoading, error } = useTemplates();
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | 'all'>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<StreamTemplate | null>(null);

  const categories = useMemo(() => {
    if (!data?.templates) return [];
    const cats = new Set(data.templates.map(t => t.category));
    return Array.from(cats);
  }, [data?.templates]);

  const filteredTemplates = useMemo(() => {
    if (!data?.templates) return [];
    if (selectedCategory === 'all') return data.templates;
    return data.templates.filter(t => t.category === selectedCategory);
  }, [data?.templates, selectedCategory]);

  const handleSelectTemplate = (template: StreamTemplate) => {
    setSelectedTemplate(template);
  };

  const handleUseTemplate = () => {
    if (selectedTemplate) {
      onSelect({
        ...DEFAULT_FORM_DATA,
        ...selectedTemplate.config
      });
    }
  };

  const handleStartFromScratch = () => {
    onSelect(DEFAULT_FORM_DATA);
    onSkip();
  };

  if (isLoading) {
    return (
      <div className="template-selector">
        <div className="template-selector-header">
          <h3>Choose a Template</h3>
          <p>Start with a pre-configured template or create from scratch</p>
        </div>
        <div className="template-selector-loading">
          Loading templates...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="template-selector">
        <div className="template-selector-header">
          <h3>Choose a Template</h3>
          <p>Start with a pre-configured template or create from scratch</p>
        </div>
        <div className="template-selector-error">
          Failed to load templates: {error.message}
        </div>
        <div className="template-selector-actions">
          <button className="btn btn-primary" onClick={handleStartFromScratch}>
            Start from Scratch
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="template-selector">
      <div className="template-selector-header">
        <h3>Choose a Template</h3>
        <p>Start with a pre-configured template or create from scratch</p>
      </div>

      {/* Category Filter */}
      <div className="template-categories">
        <button
          className={`category-btn ${selectedCategory === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('all')}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            className={`category-btn ${selectedCategory === cat ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat)}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Template Grid */}
      <div className="template-grid">
        {filteredTemplates.map(template => (
          <div
            key={template.id}
            className={`template-card ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
            onClick={() => handleSelectTemplate(template)}
          >
            <div className="template-card-header">
              <span className="template-name">{template.name}</span>
              {template.builtIn && (
                <span className="template-badge built-in">Built-in</span>
              )}
            </div>
            <p className="template-description">{template.description}</p>
            <div className="template-meta">
              <span className="template-category">
                {CATEGORY_LABELS[template.category]}
              </span>
              {template.config.width && template.config.height && (
                <span className="template-resolution">
                  {template.config.width}x{template.config.height}
                </span>
              )}
              {template.config.videoBitrate && (
                <span className="template-bitrate">
                  {template.config.videoBitrate}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Selected Template Preview */}
      {selectedTemplate && (
        <div className="template-preview">
          <h4>Selected: {selectedTemplate.name}</h4>
          <div className="template-preview-details">
            <dl>
              {selectedTemplate.config.type && (
                <>
                  <dt>Type</dt>
                  <dd>{selectedTemplate.config.type}</dd>
                </>
              )}
              {selectedTemplate.config.width && selectedTemplate.config.height && (
                <>
                  <dt>Resolution</dt>
                  <dd>{selectedTemplate.config.width}x{selectedTemplate.config.height}</dd>
                </>
              )}
              {selectedTemplate.config.fps && (
                <>
                  <dt>FPS</dt>
                  <dd>{selectedTemplate.config.fps}</dd>
                </>
              )}
              {selectedTemplate.config.preset && (
                <>
                  <dt>Preset</dt>
                  <dd>{selectedTemplate.config.preset}</dd>
                </>
              )}
              {selectedTemplate.config.videoBitrate && (
                <>
                  <dt>Video Bitrate</dt>
                  <dd>{selectedTemplate.config.videoBitrate}</dd>
                </>
              )}
              {selectedTemplate.config.audioBitrate && (
                <>
                  <dt>Audio Bitrate</dt>
                  <dd>{selectedTemplate.config.audioBitrate}</dd>
                </>
              )}
              {selectedTemplate.config.format && (
                <>
                  <dt>Format</dt>
                  <dd>{selectedTemplate.config.format === 'mpegts' ? 'MPEG-TS' : 'FLV'}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="template-selector-actions">
        <button className="btn btn-secondary" onClick={handleStartFromScratch}>
          Start from Scratch
        </button>
        <button
          className="btn btn-primary"
          onClick={handleUseTemplate}
          disabled={!selectedTemplate}
        >
          Use Selected Template
        </button>
      </div>
    </div>
  );
}
