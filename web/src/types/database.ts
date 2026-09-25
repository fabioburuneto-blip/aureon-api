/**
 * Hand-written type mirror of supabase/migrations/*.sql. Keep this in sync
 * with the schema -- if you have the Supabase CLI available, prefer
 * regenerating with `supabase gen types typescript --local` instead.
 *
 * Every table declares an empty `Relationships: []` and the schema an empty
 * `Views: {}` purely to satisfy @supabase/postgrest-js's GenericSchema
 * constraint (without them every query resolves to `never`). Embedded
 * resource selects (`.select("*, other_table(...)")`) are intentionally
 * avoided across the app instead of hand-describing real FK relationships
 * here -- fetch related rows with separate queries and join them in JS.
 */

export type BusinessSegment =
  | "barbershop"
  | "hair_salon"
  | "nails"
  | "aesthetics"
  | "tattoo"
  | "massage"
  | "personal_trainer"
  | "other";

export type MemberRole = "owner" | "staff";

export type AppointmentStatus =
  "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

export type ThemeLayout = "classic" | "minimal";

// Kept in sync with src/lib/plans/config.ts PLAN_IDS -- plan_id is plain
// text in the database (see supabase/migrations/20250924120008_billing.sql
// for why), this alias just gives the app a typed view of it.
export type SubscriptionPlan = "start" | "pro" | "business";
export type SubscriptionStatus =
  "trialing" | "active" | "past_due" | "canceled" | "incomplete";
export type BillingProviderName = "local" | "mercadopago" | "asaas" | "stripe";

export type NotificationEventType =
  | "appointment.created"
  | "appointment.confirmed"
  | "appointment.cancelled"
  | "appointment.rescheduled"
  | "appointment.completed"
  | "appointment.no_show"
  | "appointment.reminder_24h"
  | "appointment.reminder_2h";

export type NotificationChannel = "email" | "whatsapp";
export type NotificationDeliveryStatus =
  "pending" | "sent" | "failed" | "retrying";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          phone: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      businesses: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          slug: string;
          segment: BusinessSegment;
          description: string | null;
          phone: string | null;
          email: string | null;
          timezone: string;
          logo_url: string | null;
          cover_url: string | null;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never; // creation goes through the create_business() RPC
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["businesses"]["Row"],
            | "name"
            | "description"
            | "phone"
            | "email"
            | "timezone"
            | "logo_url"
            | "cover_url"
            | "is_published"
          >
        >;
        Relationships: [];
      };
      business_settings: {
        Row: {
          business_id: string;
          booking_window_days: number;
          min_notice_minutes: number;
          slot_interval_minutes: number;
          require_customer_phone: boolean;
          allow_same_day_booking: boolean;
          whatsapp_enabled: boolean;
          whatsapp_phone: string | null;
          notify_email_enabled: boolean;
          notify_email_address: string | null;
          notify_new_appointment: boolean;
          notify_cancellation: boolean;
          notify_reschedule: boolean;
          notify_reminder_24h: boolean;
          notify_reminder_2h: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["business_settings"]["Row"],
            "business_id" | "created_at" | "updated_at"
          >
        >;
        Relationships: [];
      };
      business_members: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          role: MemberRole;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["business_members"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<
          Pick<Database["public"]["Tables"]["business_members"]["Row"], "role">
        >;
        Relationships: [];
      };
      services: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          description: string | null;
          duration_minutes: number;
          price_cents: number;
          is_active: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["services"]["Row"],
          "id" | "created_at" | "updated_at" | "is_active" | "position"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["services"]["Row"],
              "is_active" | "position"
            >
          >;
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["services"]["Row"],
            "id" | "business_id"
          >
        >;
        Relationships: [];
      };
      professionals: {
        Row: {
          id: string;
          business_id: string;
          user_id: string | null;
          name: string;
          bio: string | null;
          avatar_url: string | null;
          is_active: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["professionals"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "user_id"
          | "bio"
          | "avatar_url"
          | "is_active"
          | "position"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["professionals"]["Row"],
              "user_id" | "bio" | "avatar_url" | "is_active" | "position"
            >
          >;
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["professionals"]["Row"],
            "id" | "business_id"
          >
        >;
        Relationships: [];
      };
      professional_services: {
        Row: { professional_id: string; service_id: string };
        Insert: Database["public"]["Tables"]["professional_services"]["Row"];
        Update: never;
        Relationships: [];
      };
      business_hours: {
        Row: {
          id: string;
          business_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          is_closed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["business_hours"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["business_hours"]["Row"],
            "start_time" | "end_time" | "is_closed"
          >
        >;
        Relationships: [];
      };
      professional_hours: {
        Row: {
          id: string;
          professional_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          is_closed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["professional_hours"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["professional_hours"]["Row"],
            "start_time" | "end_time" | "is_closed"
          >
        >;
        Relationships: [];
      };
      blocked_times: {
        Row: {
          id: string;
          business_id: string;
          professional_id: string | null;
          starts_at: string;
          ends_at: string;
          reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["blocked_times"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["blocked_times"]["Row"],
            "professional_id" | "starts_at" | "ends_at" | "reason"
          >
        >;
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          phone: string | null;
          email: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["customers"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["customers"]["Row"],
            "name" | "phone" | "email" | "notes"
          >
        >;
        Relationships: [];
      };
      appointments: {
        Row: {
          id: string;
          business_id: string;
          customer_id: string;
          professional_id: string;
          service_id: string;
          starts_at: string;
          ends_at: string;
          status: AppointmentStatus;
          notes: string | null;
          reminder_24h_sent_at: string | null;
          reminder_2h_sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["appointments"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "status"
          | "notes"
          | "reminder_24h_sent_at"
          | "reminder_2h_sent_at"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["appointments"]["Row"],
              "status" | "notes"
            >
          >;
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["appointments"]["Row"],
            | "status"
            | "notes"
            | "starts_at"
            | "ends_at"
            | "professional_id"
            | "reminder_24h_sent_at"
            | "reminder_2h_sent_at"
          >
        >;
        Relationships: [];
      };
      themes: {
        Row: {
          business_id: string;
          primary_color: string;
          secondary_color: string;
          font: string;
          layout: ThemeLayout;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["themes"]["Row"],
            "primary_color" | "secondary_color" | "font" | "layout"
          >
        >;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          business_id: string;
          recipient_user_id: string;
          appointment_id: string | null;
          type: NotificationEventType;
          title: string;
          body: string | null;
          read_at: string | null;
          created_at: string;
        };
        // Only ever written by the trg_appointments_notify trigger
        // (SECURITY DEFINER) -- the app never inserts a notification row.
        Insert: never;
        Update: Partial<
          Pick<Database["public"]["Tables"]["notifications"]["Row"], "read_at">
        >;
        Relationships: [];
      };
      notification_deliveries: {
        Row: {
          id: string;
          business_id: string;
          appointment_id: string | null;
          notification_id: string | null;
          channel: NotificationChannel;
          event_type: NotificationEventType;
          recipient: string;
          payload: Record<string, string>;
          status: NotificationDeliveryStatus;
          attempts: number;
          last_error: string | null;
          next_attempt_at: string;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // Only ever written by trg_appointments_notify (enqueue) and the
        // process-notifications Edge Function (status updates), both using
        // elevated privileges -- the dashboard app only ever reads this
        // table (see notification_deliveries_select_owner policy).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          business_id: string;
          provider: BillingProviderName;
          provider_customer_id: string | null;
          provider_subscription_id: string | null;
          plan_id: SubscriptionPlan;
          status: SubscriptionStatus;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        // Seeded only by create_business(). Every later change (plan,
        // status, period, provider ids) is only ever written through
        // src/lib/supabase/admin.ts's service-role client -- there is no
        // RLS UPDATE grant for the regular (cookie-bound) client at all,
        // so this Update type describes what the admin client is allowed
        // to write, not what a request acting as a signed-in user can.
        Insert: never;
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["subscriptions"]["Row"],
            "id" | "business_id" | "created_at" | "updated_at"
          >
        >;
        Relationships: [];
      };
      billing_webhook_events: {
        Row: {
          id: string;
          provider: BillingProviderName;
          provider_event_id: string;
          event_type: string;
          received_at: string;
        };
        // Only src/lib/billing/apply-event.ts (service-role client) ever
        // inserts here -- see the note on subscriptions.Update above.
        Insert: Omit<
          Database["public"]["Tables"]["billing_webhook_events"]["Row"],
          "id" | "received_at"
        >;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_business: {
        Args: {
          p_name: string;
          p_slug: string;
          p_segment: BusinessSegment;
          p_timezone?: string;
        };
        Returns: Database["public"]["Tables"]["businesses"]["Row"];
      };
      get_available_slots: {
        Args: {
          p_business_slug: string;
          p_service_id: string;
          p_professional_id: string;
          p_date: string;
        };
        Returns: { slot_start: string; slot_end: string }[];
      };
      create_public_appointment: {
        Args: {
          p_business_slug: string;
          p_service_id: string;
          p_professional_id: string;
          p_starts_at: string;
          p_customer_name: string;
          p_customer_phone: string;
          p_customer_email?: string | null;
          p_notes?: string | null;
        };
        Returns: Database["public"]["Tables"]["appointments"]["Row"];
      };
    };
  };
}
