-- Physical mailing address for CAN-SPAM compliance in marketing email footers.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mailing_address text;
