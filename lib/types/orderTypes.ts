/**
 * Type definitions for Kibo Order creation
 * These interfaces help with IntelliSense and type safety when creating orders
 * 
 * Reference: https://docs.kibocommerce.com/api-reference/order/create-order
 */

export interface Address {
  address1: string;
  address2?: string;
  address3?: string;
  address4?: string;
  cityOrTown: string;
  stateOrProvince: string;
  postalOrZipCode: string;
  countryCode: string;
  addressType?: "Commercial" | "Residential";
  isValidated?: boolean;
}

export interface PhoneNumbers {
  home?: string;
  mobile?: string;
  work?: string;
}

export interface Contact {
  firstName: string;
  middleNameOrInitial?: string;
  lastNameOrSurname: string;
  email: string;
  phoneNumbers?: PhoneNumbers;
  address?: Address;
  companyOrOrganization?: string;
}

export interface FulfillmentInfo {
  shippingMethodCode: string;
  shippingMethodName?: string;
  fulfillmentContact: Contact;
  isDestinationCommercial?: boolean;
}

export interface BillingInfo {
  billingContact: Contact;
  isSameBillingShippingAddress?: boolean;
  paymentType?: string;
}

export interface ProductPrice {
  price: number;
  salePrice?: number;
  msrp?: number;
  creditValue?: number;
}

export interface ProductInfo {
  productCode: string;
  name?: string;
  description?: string;
  price?: ProductPrice;
  imageUrl?: string;
  productTypeId?: number;
  variationProductCode?: string;
  fulfillmentTypesSupported?: string[];
  bundledProducts?: any[];
  options?: any[];
  properties?: any[];
}

export interface OrderItem {
  product: ProductInfo;
  quantity: number;
  fulfillmentMethod?: string;
  lineId?: number;
  originalCartItemId?: string;
  isTaxable?: boolean;
  isAssemblyRequired?: boolean;
  isPackagedStandAlone?: boolean;
  isRecurring?: boolean;
  substituteInfo?: {
    optIn?: string;
    substituteProductCode?: string;
    substituteVariantCode?: string;
  };
}

export interface ShopperNotes {
  comments?: string;
  deliveryInstructions?: string;
  giftMessage?: string;
}

export interface AuditInfo {
  updateDate?: string;
  createDate?: string;
  updateBy?: string;
  createBy?: string;
}

export interface ExtendedProperty {
  key: string;
  value: any;
}

export interface BasicOrder {
  // Customer Information
  email: string;
  customerId?: string;
  customerAccountId?: string;
  
  // Order Details
  orderNumber?: string;
  externalId?: string;
  submittedDate?: string;
  closedDate?: string;
  
  // Fulfillment & Billing
  fulfillmentInfo?: FulfillmentInfo;
  billingInfo: BillingInfo;
  
  // Items
  items: OrderItem[];
  
  // Pricing & Currency
  priceListCode?: string;
  currencyCode?: string;
  
  // Channel & Source
  channelCode: string;
  sourceDevice?: string;
  
  // Additional Information
  shopperNotes?: ShopperNotes;
  attributes?: any;
  auditInfo?: AuditInfo;
  extendedProperties?: ExtendedProperty[];
  
  // Status & Workflow
  status?: string;
  localeCode?: string;
  
  // Totals (usually calculated by Kibo)
  subtotal?: number;
  itemLevelProductDiscountTotal?: number;
  orderLevelProductDiscountTotal?: number;
  itemLevelShippingDiscountTotal?: number;
  orderLevelShippingDiscountTotal?: number;
  shippingTotal?: number;
  handlingTotal?: number;
  itemTaxTotal?: number;
  shippingTaxTotal?: number;
  handlingTaxTotal?: number;
  dutyTotal?: number;
  total?: number;
  feeTotal?: number;
}

