export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          changed_columns: string[] | null
          id: number
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          reason: string | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_columns?: string[] | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          reason?: string | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_columns?: string[] | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          reason?: string | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      company_bank_accounts: {
        Row: {
          account_holder: string | null
          account_number: string | null
          bank_name: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          is_active: boolean
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          address: string | null
          btw_number: string | null
          company_name: string
          created_at: string
          default_currency: Database["public"]["Enums"]["currency_code"]
          delivery_available: boolean
          due_soon_days: number
          email: string | null
          footer_text: string | null
          id: boolean
          invoice_number_prefix: string
          invoice_title: string
          kkf_number: string | null
          late_fee_percent: number
          max_open_orders_per_customer: number
          max_overdue_reminders: number
          overdue_reminder_interval_days: number
          paper_size: Database["public"]["Enums"]["paper_size"]
          pay_before_pickup: boolean
          payment_term_days: number
          payment_terms_text: string | null
          phone: string | null
          pickup_address: string | null
          pickup_hours: string | null
          pickup_instructions: string | null
          prohibited_goods_markdown: string | null
          public_signup_enabled: boolean
          show_vat_breakdown: boolean
          tagline: string | null
          terms_markdown: string | null
          terms_version: string
          updated_at: string
          updated_by: string | null
          vat_rate_percent: number | null
        }
        Insert: {
          address?: string | null
          btw_number?: string | null
          company_name: string
          created_at?: string
          default_currency?: Database["public"]["Enums"]["currency_code"]
          delivery_available?: boolean
          due_soon_days?: number
          email?: string | null
          footer_text?: string | null
          id?: boolean
          invoice_number_prefix?: string
          invoice_title: string
          kkf_number?: string | null
          late_fee_percent?: number
          max_open_orders_per_customer?: number
          max_overdue_reminders?: number
          overdue_reminder_interval_days?: number
          paper_size?: Database["public"]["Enums"]["paper_size"]
          pay_before_pickup?: boolean
          payment_term_days?: number
          payment_terms_text?: string | null
          phone?: string | null
          pickup_address?: string | null
          pickup_hours?: string | null
          pickup_instructions?: string | null
          prohibited_goods_markdown?: string | null
          public_signup_enabled?: boolean
          show_vat_breakdown?: boolean
          tagline?: string | null
          terms_markdown?: string | null
          terms_version?: string
          updated_at?: string
          updated_by?: string | null
          vat_rate_percent?: number | null
        }
        Update: {
          address?: string | null
          btw_number?: string | null
          company_name?: string
          created_at?: string
          default_currency?: Database["public"]["Enums"]["currency_code"]
          delivery_available?: boolean
          due_soon_days?: number
          email?: string | null
          footer_text?: string | null
          id?: boolean
          invoice_number_prefix?: string
          invoice_title?: string
          kkf_number?: string | null
          late_fee_percent?: number
          max_open_orders_per_customer?: number
          max_overdue_reminders?: number
          overdue_reminder_interval_days?: number
          paper_size?: Database["public"]["Enums"]["paper_size"]
          pay_before_pickup?: boolean
          payment_term_days?: number
          payment_terms_text?: string | null
          phone?: string | null
          pickup_address?: string | null
          pickup_hours?: string | null
          pickup_instructions?: string | null
          prohibited_goods_markdown?: string | null
          public_signup_enabled?: boolean
          show_vat_breakdown?: boolean
          tagline?: string | null
          terms_markdown?: string | null
          terms_version?: string
          updated_at?: string
          updated_by?: string | null
          vat_rate_percent?: number | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          address: string | null
          company_name: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          customer_code: string
          customer_number: number
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          district: string | null
          email: string | null
          full_name: string
          id: string
          kkf_number: string | null
          phone: string | null
          status: Database["public"]["Enums"]["customer_status"]
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          address?: string | null
          company_name?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string
          customer_number: number
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          district?: string | null
          email?: string | null
          full_name: string
          id?: string
          kkf_number?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["customer_status"]
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          address?: string | null
          company_name?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string
          customer_number?: number
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          district?: string | null
          email?: string | null
          full_name?: string
          id?: string
          kkf_number?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["customer_status"]
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          created_at: string
          customer_id: string | null
          error: string | null
          id: string
          idempotency_key: string
          invoice_id: string | null
          kind: Database["public"]["Enums"]["email_kind"]
          order_id: string | null
          provider_message_id: string | null
          recipient: string
          sent_at: string | null
          status: Database["public"]["Enums"]["email_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          idempotency_key: string
          invoice_id?: string | null
          kind: Database["public"]["Enums"]["email_kind"]
          order_id?: string | null
          provider_message_id?: string | null
          recipient: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          idempotency_key?: string
          invoice_id?: string | null
          kind?: Database["public"]["Enums"]["email_kind"]
          order_id?: string | null
          provider_message_id?: string | null
          recipient?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          invoice_id: string | null
          order_id: string | null
          payment_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          invoice_id?: string | null
          order_id?: string | null
          payment_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          invoice_id?: string | null
          order_id?: string | null
          payment_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          email: string
          expires_at: string
          id: string
          kind: Database["public"]["Enums"]["invitation_kind"]
          last_sent_at: string | null
          revoked_at: string | null
          send_count: number
          staff_role: Database["public"]["Enums"]["app_role"] | null
          token_hash: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          email: string
          expires_at?: string
          id?: string
          kind: Database["public"]["Enums"]["invitation_kind"]
          last_sent_at?: string | null
          revoked_at?: string | null
          send_count?: number
          staff_role?: Database["public"]["Enums"]["app_role"] | null
          token_hash: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          email?: string
          expires_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["invitation_kind"]
          last_sent_at?: string | null
          revoked_at?: string | null
          send_count?: number
          staff_role?: Database["public"]["Enums"]["app_role"] | null
          token_hash?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string
          id: string
          invoice_id: string
          line_type: Database["public"]["Enums"]["invoice_line_type"]
          order_id: string | null
          rate_per_lb: number | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          vat_exempt: boolean
          weight_lbs: number | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          invoice_id: string
          line_type: Database["public"]["Enums"]["invoice_line_type"]
          order_id?: string | null
          rate_per_lb?: number | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          vat_exempt: boolean
          weight_lbs?: number | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          invoice_id?: string
          line_type?: Database["public"]["Enums"]["invoice_line_type"]
          order_id?: string | null
          rate_per_lb?: number | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          vat_exempt?: boolean
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_counters: {
        Row: {
          last_number: number
          updated_at: string
          updated_by: string | null
          year: number
        }
        Insert: {
          last_number?: number
          updated_at?: string
          updated_by?: string | null
          year: number
        }
        Update: {
          last_number?: number
          updated_at?: string
          updated_by?: string | null
          year?: number
        }
        Relationships: []
      }
      invoices: {
        Row: {
          bill_to_snapshot: Json | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          customer_note: string | null
          due_date: string
          first_reminder_sent_at: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          issued_at: string | null
          issued_by: string | null
          issuer_snapshot: Json | null
          last_reminder_sent_at: string | null
          late_fee_applied_at: string | null
          paid_at: string | null
          reminder_count: number
          replaces_invoice_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_freight: number
          total_amount: number
          total_charges: number
          total_discount: number
          total_lbs: number
          updated_at: string
          updated_by: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          bill_to_snapshot?: Json | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          customer_note?: string | null
          due_date: string
          first_reminder_sent_at?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          issued_at?: string | null
          issued_by?: string | null
          issuer_snapshot?: Json | null
          last_reminder_sent_at?: string | null
          late_fee_applied_at?: string | null
          paid_at?: string | null
          reminder_count?: number
          replaces_invoice_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_freight?: number
          total_amount?: number
          total_charges?: number
          total_discount?: number
          total_lbs?: number
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          bill_to_snapshot?: Json | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          customer_id?: string
          customer_note?: string | null
          due_date?: string
          first_reminder_sent_at?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          issued_at?: string | null
          issued_by?: string | null
          issuer_snapshot?: Json | null
          last_reminder_sent_at?: string | null
          late_fee_applied_at?: string | null
          paid_at?: string | null
          reminder_count?: number
          replaces_invoice_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_freight?: number
          total_amount?: number
          total_charges?: number
          total_discount?: number
          total_lbs?: number
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_replaces_invoice_id_fkey"
            columns: ["replaces_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_replaces_invoice_id_fkey"
            columns: ["replaces_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          job: string
          started_at: string
          started_by: string | null
          stats: Json
          status: Database["public"]["Enums"]["job_run_status"]
          trigger: Database["public"]["Enums"]["job_trigger"]
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          job: string
          started_at?: string
          started_by?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["job_run_status"]
          trigger: Database["public"]["Enums"]["job_trigger"]
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          job?: string
          started_at?: string
          started_by?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["job_run_status"]
          trigger?: Database["public"]["Enums"]["job_trigger"]
        }
        Relationships: []
      }
      order_documents: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          kind: Database["public"]["Enums"]["order_document_kind"]
          mime_type: string
          order_id: string
          original_filename: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          kind?: Database["public"]["Enums"]["order_document_kind"]
          mime_type: string
          order_id: string
          original_filename: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["order_document_kind"]
          mime_type?: string
          order_id?: string
          original_filename?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancellation_requested_at: string | null
          carrier: string | null
          client_po_number: string | null
          created_at: string
          created_by: string | null
          created_by_role: Database["public"]["Enums"]["order_creator_role"]
          customer_id: string
          customer_note: string | null
          declared_weight_lbs: number | null
          description: string | null
          estimated_value: number | null
          estimated_value_currency: Database["public"]["Enums"]["currency_code"]
          expected_delivery_date: string | null
          handed_over_by: string | null
          id: string
          measured_weight_lbs: number | null
          order_type: Database["public"]["Enums"]["order_type"]
          parent_order_id: string | null
          picked_up_at: string | null
          picked_up_by_name: string | null
          purchase_date: string | null
          purchase_mode: Database["public"]["Enums"]["purchase_mode"] | null
          quantity: number
          received_at: string | null
          received_by: string | null
          reference: string
          service_type: Database["public"]["Enums"]["service_type"]
          shipment_id: string | null
          status: string
          store_vendor: string | null
          supplier_name: string | null
          tracking_number: string | null
          tracking_number_normalized: string | null
          updated_at: string
          updated_by: string | null
          vendor_order_number: string | null
        }
        Insert: {
          cancellation_requested_at?: string | null
          carrier?: string | null
          client_po_number?: string | null
          created_at?: string
          created_by?: string | null
          created_by_role?: Database["public"]["Enums"]["order_creator_role"]
          customer_id: string
          customer_note?: string | null
          declared_weight_lbs?: number | null
          description?: string | null
          estimated_value?: number | null
          estimated_value_currency?: Database["public"]["Enums"]["currency_code"]
          expected_delivery_date?: string | null
          handed_over_by?: string | null
          id?: string
          measured_weight_lbs?: number | null
          order_type?: Database["public"]["Enums"]["order_type"]
          parent_order_id?: string | null
          picked_up_at?: string | null
          picked_up_by_name?: string | null
          purchase_date?: string | null
          purchase_mode?: Database["public"]["Enums"]["purchase_mode"] | null
          quantity?: number
          received_at?: string | null
          received_by?: string | null
          reference?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          shipment_id?: string | null
          status?: string
          store_vendor?: string | null
          supplier_name?: string | null
          tracking_number?: string | null
          tracking_number_normalized?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_order_number?: string | null
        }
        Update: {
          cancellation_requested_at?: string | null
          carrier?: string | null
          client_po_number?: string | null
          created_at?: string
          created_by?: string | null
          created_by_role?: Database["public"]["Enums"]["order_creator_role"]
          customer_id?: string
          customer_note?: string | null
          declared_weight_lbs?: number | null
          description?: string | null
          estimated_value?: number | null
          estimated_value_currency?: Database["public"]["Enums"]["currency_code"]
          expected_delivery_date?: string | null
          handed_over_by?: string | null
          id?: string
          measured_weight_lbs?: number | null
          order_type?: Database["public"]["Enums"]["order_type"]
          parent_order_id?: string | null
          picked_up_at?: string | null
          picked_up_by_name?: string | null
          purchase_date?: string | null
          purchase_mode?: Database["public"]["Enums"]["purchase_mode"] | null
          quantity?: number
          received_at?: string | null
          received_by?: string | null
          reference?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          shipment_id?: string | null
          status?: string
          store_vendor?: string | null
          supplier_name?: string | null
          tracking_number?: string | null
          tracking_number_normalized?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_order_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_status_fkey"
            columns: ["status"]
            isOneToOne: false
            referencedRelation: "shipment_statuses"
            referencedColumns: ["code"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          customer_note: string | null
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_on: string
          received_amount: number | null
          received_currency: Database["public"]["Enums"]["currency_code"] | null
          recorded_by: string | null
          reference: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_note?: string | null
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_on?: string
          received_amount?: number | null
          received_currency?:
            | Database["public"]["Enums"]["currency_code"]
            | null
          recorded_by?: string | null
          reference?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_note?: string | null
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          paid_on?: string
          received_amount?: number | null
          received_currency?:
            | Database["public"]["Enums"]["currency_code"]
            | null
          recorded_by?: string | null
          reference?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_rates: {
        Row: {
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          enabled: boolean
          minimum_billable_lbs: number | null
          rate_per_lb: number | null
          service_type: Database["public"]["Enums"]["service_type"]
          updated_at: string
          updated_by: string | null
          weight_rounding: Database["public"]["Enums"]["weight_rounding"]
        }
        Insert: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          enabled?: boolean
          minimum_billable_lbs?: number | null
          rate_per_lb?: number | null
          service_type: Database["public"]["Enums"]["service_type"]
          updated_at?: string
          updated_by?: string | null
          weight_rounding?: Database["public"]["Enums"]["weight_rounding"]
        }
        Update: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          enabled?: boolean
          minimum_billable_lbs?: number | null
          rate_per_lb?: number | null
          service_type?: Database["public"]["Enums"]["service_type"]
          updated_at?: string
          updated_by?: string | null
          weight_rounding?: Database["public"]["Enums"]["weight_rounding"]
        }
        Relationships: []
      }
      shipment_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          customer_message: string | null
          from_status: string
          id: number
          order_id: string
          to_status: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          customer_message?: string | null
          from_status: string
          id?: never
          order_id: string
          to_status: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          customer_message?: string | null
          from_status?: string
          id?: never
          order_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_status_history_from_status_fkey"
            columns: ["from_status"]
            isOneToOne: false
            referencedRelation: "shipment_statuses"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "shipment_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_status_history_to_status_fkey"
            columns: ["to_status"]
            isOneToOne: false
            referencedRelation: "shipment_statuses"
            referencedColumns: ["code"]
          },
        ]
      }
      shipment_statuses: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          customer_description_nl: string | null
          customer_visible: boolean
          is_terminal: boolean
          label_nl: string
          notify_customer: boolean
          sort_order: number
          stage: Database["public"]["Enums"]["status_stage"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          customer_description_nl?: string | null
          customer_visible?: boolean
          is_terminal?: boolean
          label_nl: string
          notify_customer?: boolean
          sort_order?: number
          stage: Database["public"]["Enums"]["status_stage"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          customer_description_nl?: string | null
          customer_visible?: boolean
          is_terminal?: boolean
          label_nl?: string
          notify_customer?: boolean
          sort_order?: number
          stage?: Database["public"]["Enums"]["status_stage"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      shipments: {
        Row: {
          arrived_at: string | null
          awb_or_container_number: string | null
          carrier: string | null
          created_at: string
          created_by: string | null
          customer_note: string | null
          departed_at: string | null
          id: string
          service_type: Database["public"]["Enums"]["service_type"]
          shipment_number: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          arrived_at?: string | null
          awb_or_container_number?: string | null
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          customer_note?: string | null
          departed_at?: string | null
          id?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          shipment_number: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          arrived_at?: string | null
          awb_or_container_number?: string | null
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          customer_note?: string | null
          departed_at?: string | null
          id?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          shipment_number?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      staff_tasks: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          email: string | null
          id: string
          kind: Database["public"]["Enums"]["staff_task_kind"]
          order_id: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          email?: string | null
          id?: string
          kind: Database["public"]["Enums"]["staff_task_kind"]
          order_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          email?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["staff_task_kind"]
          order_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_tasks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      warehouse_addresses: {
        Row: {
          address_line1: string
          address_line2_template: string
          city: string
          country: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string
          phone: string | null
          recipient_name_template: string
          service_type: Database["public"]["Enums"]["service_type"]
          state: string
          updated_at: string
          updated_by: string | null
          zip: string
        }
        Insert: {
          address_line1: string
          address_line2_template?: string
          city: string
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label: string
          phone?: string | null
          recipient_name_template?: string
          service_type: Database["public"]["Enums"]["service_type"]
          state: string
          updated_at?: string
          updated_by?: string | null
          zip: string
        }
        Update: {
          address_line1?: string
          address_line2_template?: string
          city?: string
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string
          phone?: string | null
          recipient_name_template?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          state?: string
          updated_at?: string
          updated_by?: string | null
          zip?: string
        }
        Relationships: []
      }
    }
    Views: {
      invoice_overview: {
        Row: {
          amount_paid: number | null
          balance_due: number | null
          bill_to_snapshot: Json | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string | null
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"] | null
          customer_id: string | null
          customer_note: string | null
          days_overdue: number | null
          due_date: string | null
          first_reminder_sent_at: string | null
          id: string | null
          invoice_date: string | null
          invoice_number: string | null
          is_overdue: boolean | null
          issued_at: string | null
          issued_by: string | null
          issuer_snapshot: Json | null
          last_reminder_sent_at: string | null
          late_fee_applied_at: string | null
          paid_at: string | null
          reminder_count: number | null
          replaces_invoice_id: string | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          subtotal_freight: number | null
          total_amount: number | null
          total_charges: number | null
          total_discount: number | null
          total_lbs: number | null
          updated_at: string | null
          updated_by: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_replaces_invoice_id_fkey"
            columns: ["replaces_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_replaces_invoice_id_fkey"
            columns: ["replaces_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_auth_user_by_email: {
        Args: { _email: string }
        Returns: {
          created_at: string
          email: string
          email_confirmed_at: string
          id: string
        }[]
      }
      apply_late_fee: {
        Args: { _invoice_id: string }
        Returns: {
          bill_to_snapshot: Json | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          customer_note: string | null
          due_date: string
          first_reminder_sent_at: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          issued_at: string | null
          issued_by: string | null
          issuer_snapshot: Json | null
          last_reminder_sent_at: string | null
          late_fee_applied_at: string | null
          paid_at: string | null
          reminder_count: number
          replaces_invoice_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_freight: number
          total_amount: number
          total_charges: number
          total_discount: number
          total_lbs: number
          updated_at: string
          updated_by: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_invoice: {
        Args: { _invoice_id: string; _reason: string }
        Returns: {
          bill_to_snapshot: Json | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          customer_note: string | null
          due_date: string
          first_reminder_sent_at: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          issued_at: string | null
          issued_by: string | null
          issuer_snapshot: Json | null
          last_reminder_sent_at: string | null
          late_fee_applied_at: string | null
          paid_at: string | null
          reminder_count: number
          replaces_invoice_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_freight: number
          total_amount: number
          total_charges: number
          total_discount: number
          total_lbs: number
          updated_at: string
          updated_by: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_customer_code: {
        Args: { _code: string; _id: string; _reason: string }
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"]
          address: string | null
          company_name: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          customer_code: string
          customer_number: number
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          district: string | null
          email: string | null
          full_name: string
          id: string
          kkf_number: string | null
          phone: string | null
          status: Database["public"]["Enums"]["customer_status"]
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_order_status: {
        Args: {
          _customer_message?: string
          _order_ids: string[]
          _picked_up_by_name?: string
          _to_status: string
        }
        Returns: {
          customer_id: string
          history_id: number
          notify: boolean
          order_id: string
        }[]
      }
      create_customer: {
        Args: {
          _account_type?: Database["public"]["Enums"]["account_type"]
          _address?: string
          _code?: string
          _company_name?: string
          _contact_person?: string
          _district?: string
          _email?: string
          _full_name: string
          _kkf_number?: string
          _phone: string
        }
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"]
          address: string | null
          company_name: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          customer_code: string
          customer_number: number
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          district: string | null
          email: string | null
          full_name: string
          id: string
          kkf_number: string | null
          phone: string | null
          status: Database["public"]["Enums"]["customer_status"]
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_customer_id: { Args: never; Returns: string }
      customer_history_by_year: {
        Args: { _customer_id?: string }
        Returns: {
          invoice_count: number
          order_count: number
          payment_count: number
          shipment_count: number
          year: number
        }[]
      }
      get_invitation: {
        Args: { _token_hash: string }
        Returns: {
          accepted_at: string
          customer_code: string
          customer_id: string
          email: string
          expires_at: string
          full_name: string
          invitation_id: string
          is_expired: boolean
          kind: Database["public"]["Enums"]["invitation_kind"]
          revoked_at: string
          staff_role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      issue_invoice: {
        Args: { _invoice_id: string }
        Returns: {
          bill_to_snapshot: Json | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          customer_note: string | null
          due_date: string
          first_reminder_sent_at: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          issued_at: string | null
          issued_by: string | null
          issuer_snapshot: Json | null
          last_reminder_sent_at: string | null
          late_fee_applied_at: string | null
          paid_at: string | null
          reminder_count: number
          replaces_invoice_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_freight: number
          total_amount: number
          total_charges: number
          total_discount: number
          total_lbs: number
          updated_at: string
          updated_by: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      peek_next_customer_number: { Args: never; Returns: number }
      pickup_override: {
        Args: {
          _customer_message?: string
          _order_ids: string[]
          _picked_up_by_name: string
          _reason: string
          _to_status: string
        }
        Returns: {
          customer_id: string
          history_id: number
          notify: boolean
          order_id: string
        }[]
      }
      public_company_info: {
        Args: never
        Returns: {
          address: string
          company_name: string
          email: string
          phone: string
          pickup_address: string
          pickup_hours: string
          pickup_instructions: string
          prohibited_goods_markdown: string
          public_signup_enabled: boolean
          tagline: string
          terms_markdown: string
          terms_version: string
        }[]
      }
      receive_order: {
        Args: { _measured_weight_lbs: number; _order_id: string }
        Returns: {
          customer_id: string
          history_id: number
          notify: boolean
          order_id: string
        }[]
      }
      record_payment: {
        Args: {
          _amount?: number
          _customer_note?: string
          _invoice_id: string
          _method?: Database["public"]["Enums"]["payment_method"]
          _paid_on?: string
          _received_amount?: number
          _received_currency?: Database["public"]["Enums"]["currency_code"]
          _reference?: string
        }
        Returns: {
          amount_paid: number
          balance_due: number
          invoice_status: Database["public"]["Enums"]["invoice_status"]
          payment_id: string
        }[]
      }
      redeem_invitation: {
        Args: { _token_hash: string; _user_id: string }
        Returns: {
          customer_id: string
          invitation_id: string
          kind: Database["public"]["Enums"]["invitation_kind"]
          staff_role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      request_order_cancellation: {
        Args: { _order_id: string }
        Returns: string
      }
      set_invoice_counter: {
        Args: { _last_number: number; _year: number }
        Returns: number
      }
      set_next_customer_number: { Args: { _next: number }; Returns: number }
      set_user_role: {
        Args: {
          _grant: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      update_my_contact: {
        Args: {
          _address?: string
          _contact_person?: string
          _district?: string
          _phone?: string
        }
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"]
          address: string | null
          company_name: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          customer_code: string
          customer_number: number
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          district: string | null
          email: string | null
          full_name: string
          id: string
          kkf_number: string | null
          phone: string | null
          status: Database["public"]["Enums"]["customer_status"]
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_payment: {
        Args: { _payment_id: string; _reason: string }
        Returns: {
          amount_paid: number
          balance_due: number
          invoice_status: Database["public"]["Enums"]["invoice_status"]
          payment_id: string
        }[]
      }
    }
    Enums: {
      account_type: "personal" | "business"
      app_role: "admin" | "staff"
      currency_code: "USD" | "EUR" | "SRD"
      customer_status: "invited" | "active" | "disabled"
      email_kind:
        | "invitation"
        | "welcome"
        | "order_confirmation"
        | "status_update"
        | "invoice_issued"
        | "payment_received"
        | "payment_reminder_due_soon"
        | "payment_reminder_overdue"
      email_status: "queued" | "sent" | "failed" | "skipped_no_provider"
      invitation_kind: "customer" | "staff"
      invoice_line_type:
        | "freight"
        | "customs"
        | "handling"
        | "goods"
        | "service_fee"
        | "other"
        | "discount"
        | "late_fee"
      invoice_status: "draft" | "open" | "partially_paid" | "paid" | "cancelled"
      job_run_status: "running" | "succeeded" | "failed"
      job_trigger: "cron" | "manual"
      order_creator_role: "customer" | "staff"
      order_document_kind:
        | "purchase_invoice"
        | "commercial_invoice"
        | "packing_list"
        | "customs_document"
        | "other"
      order_type: "personal" | "b2b"
      paper_size: "Letter" | "A4"
      payment_method: "bank_transfer" | "cash" | "pin" | "mobile" | "other"
      purchase_mode: "customer_purchased" | "gr_purchases"
      service_type: "air" | "sea"
      staff_task_kind:
        | "signup_email_conflict"
        | "signup_customer_failed"
        | "order_cancellation_request"
      status_stage:
        | "registered"
        | "us_warehouse"
        | "in_transit"
        | "arrived_sr"
        | "at_customs"
        | "cleared"
        | "ready_for_pickup"
        | "completed"
        | "cancelled"
        | "action_required"
      weight_rounding: "none" | "0.1" | "0.5" | "1"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["personal", "business"],
      app_role: ["admin", "staff"],
      currency_code: ["USD", "EUR", "SRD"],
      customer_status: ["invited", "active", "disabled"],
      email_kind: [
        "invitation",
        "welcome",
        "order_confirmation",
        "status_update",
        "invoice_issued",
        "payment_received",
        "payment_reminder_due_soon",
        "payment_reminder_overdue",
      ],
      email_status: ["queued", "sent", "failed", "skipped_no_provider"],
      invitation_kind: ["customer", "staff"],
      invoice_line_type: [
        "freight",
        "customs",
        "handling",
        "goods",
        "service_fee",
        "other",
        "discount",
        "late_fee",
      ],
      invoice_status: ["draft", "open", "partially_paid", "paid", "cancelled"],
      job_run_status: ["running", "succeeded", "failed"],
      job_trigger: ["cron", "manual"],
      order_creator_role: ["customer", "staff"],
      order_document_kind: [
        "purchase_invoice",
        "commercial_invoice",
        "packing_list",
        "customs_document",
        "other",
      ],
      order_type: ["personal", "b2b"],
      paper_size: ["Letter", "A4"],
      payment_method: ["bank_transfer", "cash", "pin", "mobile", "other"],
      purchase_mode: ["customer_purchased", "gr_purchases"],
      service_type: ["air", "sea"],
      staff_task_kind: [
        "signup_email_conflict",
        "signup_customer_failed",
        "order_cancellation_request",
      ],
      status_stage: [
        "registered",
        "us_warehouse",
        "in_transit",
        "arrived_sr",
        "at_customs",
        "cleared",
        "ready_for_pickup",
        "completed",
        "cancelled",
        "action_required",
      ],
      weight_rounding: ["none", "0.1", "0.5", "1"],
    },
  },
} as const
