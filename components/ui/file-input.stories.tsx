import type { Meta, StoryObj } from '@storybook/react';
import { FileInput } from './file-input';
import { useState } from 'react';

const meta: Meta<typeof FileInput> = {
  title: 'UI/FileInput',
  component: FileInput,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    error: { control: 'text' },
    hint: { control: 'text' },
    disabled: { control: 'boolean' },
    maxSizeMB: { control: { type: 'number', min: 1, max: 100 } },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default file input with drag and drop
 */
export const Default: Story = {
  render: () => {
    const [file, setFile] = useState<File | string | null>(null);
    return (
      <div className="w-[480px]">
        <FileInput
          label="Invoice Document"
          placeholder="Drag & drop your invoice PDF here, or browse"
          value={file}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setFile(files[0]);
            } else {
              setFile(null);
            }
          }}
          hint="Only PDF up to 10MB"
        />
        {file && (
          <p className="mt-2 text-sm text-zinc-400">
            Selected: {file instanceof File ? file.name : file}
          </p>
        )}
      </div>
    );
  },
};

/**
 * File input with a pre-selected file
 */
export const WithValue: Story = {
  render: () => {
    const [file, setFile] = useState<File | string | null>(
      'https://example.com/sample-invoice.pdf'
    );
    return (
      <div className="w-[480px]">
        <FileInput
          label="Invoice Document"
          value={file}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setFile(files[0]);
            } else {
              setFile(null);
            }
          }}
        />
      </div>
    );
  },
};

/**
 * File input in error state
 */
export const Error: Story = {
  render: () => {
    const [file, setFile] = useState<File | string | null>(null);
    return (
      <div className="w-[480px]">
        <FileInput
          label="Invoice Document"
          maxSizeMB={5}
          value={file}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setFile(files[0]);
            } else {
              setFile(null);
            }
          }}
          error="File is too large (max 5MB)"
        />
      </div>
    );
  },
};

/**
 * File input in success state
 */
export const Success: Story = {
  render: () => {
    const [file, setFile] = useState<File | string | null>(
      'https://example.com/valid-invoice.pdf'
    );
    return (
      <div className="w-[480px]">
        <FileInput
          label="Invoice Document"
          value={file}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setFile(files[0]);
            } else {
              setFile(null);
            }
          }}
          success
        />
      </div>
    );
  },
};

/**
 * Disabled file input
 */
export const Disabled: Story = {
  render: () => {
    const [file, setFile] = useState<File | string | null>(null);
    return (
      <div className="w-[480px]">
        <FileInput
          label="Invoice Document"
          value={file}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setFile(files[0]);
            } else {
              setFile(null);
            }
          }}
          disabled
        />
      </div>
    );
  },
};

/**
 * File input with custom max file size
 */
export const CustomMaxSize: Story = {
  render: () => {
    const [file, setFile] = useState<File | string | null>(null);
    return (
      <div className="w-[480px]">
        <FileInput
          label="Large Document"
          value={file}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setFile(files[0]);
            } else {
              setFile(null);
            }
          }}
          maxSizeMB={25}
          hint="Only PDF up to 25MB"
        />
      </div>
    );
  },
};

/**
 * File input with hint text
 */
export const WithHint: Story = {
  render: () => {
    const [file, setFile] = useState<File | string | null>(null);
    return (
      <div className="w-[480px]">
        <FileInput
          label="Supporting Document"
          value={file}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setFile(files[0]);
            } else {
              setFile(null);
            }
          }}
          hint="Upload any supporting documentation (PDF only)"
        />
      </div>
    );
  },
};