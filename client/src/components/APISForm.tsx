/**
 * APIS (Advance Passenger Information System) Data Collection Form
 *
 * Collects travel document, personal, and address information from passengers
 * for submission to destination country authorities. Supports EN/AR localization.
 */

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Check,
  AlertTriangle,
  Loader2,
  Shield,
  User,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

type DocumentType = "passport" | "national_id";
type Gender = "M" | "F" | "U";

interface APISFormData {
  documentType: DocumentType;
  documentNumber: string;
  issuingCountry: string;
  nationality: string;
  dateOfBirth: string;
  gender: Gender;
  expiryDate: string;
  givenNames: string;
  surname: string;
  residenceCountry: string;
  residenceAddress: string;
  destinationAddress: string;
  redressNumber: string;
  knownTravelerNumber: string;
}

interface APISFormProps {
  passengerId: number;
  passengerName?: string;
  originCountry?: string;
  destinationCountry?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  className?: string;
  initialData?: Partial<APISFormData>;
}

interface FieldError {
  field: string;
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

const INITIAL_FORM_DATA: APISFormData = {
  documentType: "passport",
  documentNumber: "",
  issuingCountry: "",
  nationality: "",
  dateOfBirth: "",
  gender: "M",
  expiryDate: "",
  givenNames: "",
  surname: "",
  residenceCountry: "",
  residenceAddress: "",
  destinationAddress: "",
  redressNumber: "",
  knownTravelerNumber: "",
};

/**
 * Common country codes for quick selection.
 * ISO 3166-1 alpha-2 codes used in aviation.
 */
const COMMON_COUNTRIES = [
  { code: "SA", label: "Saudi Arabia" },
  { code: "AE", label: "United Arab Emirates" },
  { code: "EG", label: "Egypt" },
  { code: "JO", label: "Jordan" },
  { code: "LB", label: "Lebanon" },
  { code: "KW", label: "Kuwait" },
  { code: "BH", label: "Bahrain" },
  { code: "QA", label: "Qatar" },
  { code: "OM", label: "Oman" },
  { code: "IQ", label: "Iraq" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IN", label: "India" },
  { code: "PK", label: "Pakistan" },
  { code: "TR", label: "Turkey" },
  { code: "MY", label: "Malaysia" },
  { code: "ID", label: "Indonesia" },
  { code: "PH", label: "Philippines" },
];

// Required base fields for all destinations
const BASE_REQUIRED_FIELDS = [
  "documentType",
  "documentNumber",
  "issuingCountry",
  "nationality",
  "dateOfBirth",
  "gender",
  "expiryDate",
  "givenNames",
  "surname",
];

// Destinations that require address fields
const ADDRESS_REQUIRED_DESTINATIONS = ["US", "GB", "CA", "AU"];

// ============================================================================
// Component
// ============================================================================

export function APISForm({
  passengerId,
  passengerName,
  originCountry,
  destinationCountry,
  onSuccess,
  onCancel,
  className,
  initialData,
}: APISFormProps) {
  const { t } = useTranslation();

  // Form state
  const [formData, setFormData] = useState<APISFormData>({
    ...INITIAL_FORM_DATA,
    ...initialData,
  });
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch route requirements if countries are provided
  const requirementsQuery = trpc.apis.getRequirements.useQuery(
    {
      originCountry: originCountry ?? "SA",
      destinationCountry: destinationCountry ?? "SA",
    },
    {
      enabled: !!originCountry && !!destinationCountry,
    }
  );

  // Submit mutation
  const submitMutation = trpc.apis.submitInfo.useMutation({
    onSuccess: () => {
      toast.success(
        t(
          "apis.submitSuccess",
          "Travel document information saved successfully"
        )
      );
      onSuccess?.();
    },
    onError: (error: { message: string }) => {
      toast.error(
        error.message ||
          t("apis.submitError", "Failed to save travel document information")
      );
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  // Determine which fields are required for this route
  const requiredFields = useMemo(() => {
    if (requirementsQuery.data?.requiredFields) {
      return requirementsQuery.data.requiredFields;
    }
    // Default: base required fields + address if going to US/GB/CA/AU
    const fields = [...BASE_REQUIRED_FIELDS];
    if (
      destinationCountry &&
      ADDRESS_REQUIRED_DESTINATIONS.includes(destinationCountry)
    ) {
      fields.push("residenceCountry", "residenceAddress", "destinationAddress");
    }
    return fields;
  }, [requirementsQuery.data, destinationCountry]);

  // Calculate completeness percentage
  const completeness = useMemo(() => {
    const allTrackableFields = [
      "documentType",
      "documentNumber",
      "issuingCountry",
      "nationality",
      "dateOfBirth",
      "gender",
      "expiryDate",
      "givenNames",
      "surname",
      "residenceCountry",
      "residenceAddress",
      "destinationAddress",
      "redressNumber",
      "knownTravelerNumber",
    ];

    const filled = allTrackableFields.filter(
      f => formData[f as keyof APISFormData]?.trim() !== ""
    );

    return Math.round((filled.length / allTrackableFields.length) * 100);
  }, [formData]);

  // Calculate required field completeness
  const requiredCompleteness = useMemo(() => {
    const filledRequired = requiredFields.filter((f: string) => {
      const value = formData[f as keyof APISFormData];
      return value !== undefined && value.trim() !== "";
    });
    return requiredFields.length > 0
      ? Math.round((filledRequired.length / requiredFields.length) * 100)
      : 100;
  }, [formData, requiredFields]);

  // Field change handler
  const handleFieldChange = useCallback(
    (field: keyof APISFormData, value: string) => {
      setFormData(prev => ({ ...prev, [field]: value }));
      // Clear error for this field
      setFieldErrors(prev => prev.filter(e => e.field !== field));
    },
    []
  );

  // Validate form before submission
  const validateForm = useCallback((): boolean => {
    const errors: FieldError[] = [];

    // Check required fields
    for (const field of requiredFields) {
      const value = formData[field as keyof APISFormData];
      if (!value || value.trim() === "") {
        const label =
          field === "documentType"
            ? t("apis.documentType", "Document type")
            : field === "documentNumber"
              ? t("apis.documentNumber", "Document number")
              : field === "issuingCountry"
                ? t("apis.issuingCountry", "Issuing country")
                : field === "nationality"
                  ? t("apis.nationality", "Nationality")
                  : field === "dateOfBirth"
                    ? t("apis.dateOfBirth", "Date of birth")
                    : field === "gender"
                      ? t("apis.gender", "Gender")
                      : field === "expiryDate"
                        ? t("apis.expiryDate", "Expiry date")
                        : field === "givenNames"
                          ? t("apis.givenNames", "Given names")
                          : field === "surname"
                            ? t("apis.surname", "Surname")
                            : field;
        errors.push({
          field,
          message: t("apis.fieldRequired", "{{field}} is required", {
            field: label,
          }),
        });
      }
    }

    // Validate document number format
    if (
      formData.documentNumber &&
      !/^[A-Za-z0-9]{5,20}$/.test(formData.documentNumber)
    ) {
      errors.push({
        field: "documentNumber",
        message: t(
          "apis.invalidDocNumber",
          "Document number must be 5-20 alphanumeric characters"
        ),
      });
    }

    // Validate country codes
    const countryFields: Array<{ field: keyof APISFormData; label: string }> = [
      {
        field: "issuingCountry",
        label: t("apis.issuingCountry", "Issuing country"),
      },
      { field: "nationality", label: t("apis.nationality", "Nationality") },
    ];
    if (formData.residenceCountry) {
      countryFields.push({
        field: "residenceCountry",
        label: t("apis.residenceCountry", "Residence country"),
      });
    }
    for (const { field, label } of countryFields) {
      const val = formData[field];
      if (val && !/^[A-Z]{2,3}$/i.test(val)) {
        errors.push({
          field,
          message: t(
            "apis.invalidCountryCode",
            "{{field}} must be a valid country code",
            { field: label }
          ),
        });
      }
    }

    // Validate expiry date is in the future
    if (formData.expiryDate) {
      const expiry = new Date(formData.expiryDate);
      if (expiry <= new Date()) {
        errors.push({
          field: "expiryDate",
          message: t("apis.documentExpired", "Travel document has expired"),
        });
      }
    }

    // Validate date of birth is in the past
    if (formData.dateOfBirth) {
      const dob = new Date(formData.dateOfBirth);
      if (dob >= new Date()) {
        errors.push({
          field: "dateOfBirth",
          message: t("apis.invalidDOB", "Date of birth must be in the past"),
        });
      }
    }

    setFieldErrors(errors);
    return errors.length === 0;
  }, [formData, requiredFields, t]);

  // Submit handler
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!validateForm()) {
        toast.error(
          t("apis.validationErrors", "Please fix the errors before submitting")
        );
        return;
      }

      setIsSubmitting(true);
      submitMutation.mutate({
        passengerId,
        documentType: formData.documentType,
        documentNumber: formData.documentNumber.toUpperCase(),
        issuingCountry: formData.issuingCountry.toUpperCase(),
        nationality: formData.nationality.toUpperCase(),
        dateOfBirth: formData.dateOfBirth,
        gender: formData.gender,
        expiryDate: formData.expiryDate,
        givenNames: formData.givenNames,
        surname: formData.surname,
        residenceCountry: formData.residenceCountry
          ? formData.residenceCountry.toUpperCase()
          : undefined,
        residenceAddress: formData.residenceAddress || undefined,
        destinationAddress: formData.destinationAddress || undefined,
        redressNumber: formData.redressNumber || undefined,
        knownTravelerNumber: formData.knownTravelerNumber || undefined,
      });
    },
    [validateForm, submitMutation, passengerId, formData, t]
  );

  // Helper to check if a field has an error
  const getFieldError = (field: string): string | undefined => {
    return fieldErrors.find(e => e.field === field)?.message;
  };

  // Helper to check if a field is required
  const isRequired = (field: string): boolean => {
    return requiredFields.includes(field);
  };

  const needsAddressInfo =
    destinationCountry &&
    ADDRESS_REQUIRED_DESTINATIONS.includes(destinationCountry);

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-6", className)}>
      {/* Progress Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {t("apis.title", "Travel Document Information (APIS)")}
              </CardTitle>
              <CardDescription className="mt-1">
                {passengerName
                  ? t(
                      "apis.descriptionForPassenger",
                      "Required travel information for {{name}}",
                      {
                        name: passengerName,
                      }
                    )
                  : t(
                      "apis.description",
                      "Advance Passenger Information required by destination authorities"
                    )}
              </CardDescription>
            </div>
            <Badge
              variant={
                requiredCompleteness === 100
                  ? "default"
                  : requiredCompleteness > 50
                    ? "secondary"
                    : "destructive"
              }
            >
              {requiredCompleteness === 100
                ? t("apis.complete", "Complete")
                : t("apis.incomplete", "Incomplete")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t("apis.progress", "Form completion")}
              </span>
              <span className="font-medium">{completeness}%</span>
            </div>
            <Progress value={completeness} />
            {requiredCompleteness < 100 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "apis.requiredFieldsNote",
                  "Required fields: {{percent}}% complete",
                  { percent: requiredCompleteness }
                )}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 1: Document Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            {t("apis.documentDetails", "Document Details")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Document Type */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("apis.documentType", "Document Type")}
              {isRequired("documentType") && (
                <span className="text-destructive ms-1">*</span>
              )}
            </Label>
            <RadioGroup
              value={formData.documentType}
              onValueChange={value =>
                handleFieldChange("documentType", value as DocumentType)
              }
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="passport" id="doc-passport" />
                <Label
                  htmlFor="doc-passport"
                  className="font-normal cursor-pointer"
                >
                  {t("apis.passport", "Passport")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="national_id" id="doc-national-id" />
                <Label
                  htmlFor="doc-national-id"
                  className="font-normal cursor-pointer"
                >
                  {t("apis.nationalId", "National ID")}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Document Number */}
          <div className="space-y-2">
            <Label htmlFor="apis-doc-number" className="text-sm font-medium">
              {t("apis.documentNumber", "Document Number")}
              {isRequired("documentNumber") && (
                <span className="text-destructive ms-1">*</span>
              )}
            </Label>
            <Input
              id="apis-doc-number"
              type="text"
              value={formData.documentNumber}
              onChange={e =>
                handleFieldChange(
                  "documentNumber",
                  e.target.value.toUpperCase()
                )
              }
              placeholder={t(
                "apis.documentNumberPlaceholder",
                "e.g. A12345678"
              )}
              maxLength={20}
              className={cn(
                "uppercase",
                getFieldError("documentNumber") && "border-destructive"
              )}
            />
            {getFieldError("documentNumber") && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {getFieldError("documentNumber")}
              </p>
            )}
          </div>

          {/* Issuing Country & Expiry Date row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Issuing Country */}
            <div className="space-y-2">
              <Label
                htmlFor="apis-issuing-country"
                className="text-sm font-medium"
              >
                {t("apis.issuingCountry", "Issuing Country")}
                {isRequired("issuingCountry") && (
                  <span className="text-destructive ms-1">*</span>
                )}
              </Label>
              <Select
                value={formData.issuingCountry}
                onValueChange={value =>
                  handleFieldChange("issuingCountry", value)
                }
              >
                <SelectTrigger
                  className={cn(
                    "w-full",
                    getFieldError("issuingCountry") && "border-destructive"
                  )}
                >
                  <SelectValue
                    placeholder={t("apis.selectCountry", "Select country")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_COUNTRIES.map(country => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.code} - {country.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {getFieldError("issuingCountry") && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {getFieldError("issuingCountry")}
                </p>
              )}
            </div>

            {/* Expiry Date */}
            <div className="space-y-2">
              <Label htmlFor="apis-expiry-date" className="text-sm font-medium">
                {t("apis.expiryDate", "Expiry Date")}
                {isRequired("expiryDate") && (
                  <span className="text-destructive ms-1">*</span>
                )}
              </Label>
              <Input
                id="apis-expiry-date"
                type="date"
                value={formData.expiryDate}
                onChange={e => handleFieldChange("expiryDate", e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className={cn(
                  getFieldError("expiryDate") && "border-destructive"
                )}
              />
              {getFieldError("expiryDate") && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {getFieldError("expiryDate")}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Personal Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            {t("apis.personalInfo", "Personal Information")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Given Names & Surname row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="apis-given-names" className="text-sm font-medium">
                {t("apis.givenNames", "Given Names")}
                {isRequired("givenNames") && (
                  <span className="text-destructive ms-1">*</span>
                )}
              </Label>
              <Input
                id="apis-given-names"
                type="text"
                value={formData.givenNames}
                onChange={e => handleFieldChange("givenNames", e.target.value)}
                placeholder={t(
                  "apis.givenNamesPlaceholder",
                  "As shown on document"
                )}
                maxLength={100}
                className={cn(
                  getFieldError("givenNames") && "border-destructive"
                )}
              />
              {getFieldError("givenNames") && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {getFieldError("givenNames")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="apis-surname" className="text-sm font-medium">
                {t("apis.surname", "Surname")}
                {isRequired("surname") && (
                  <span className="text-destructive ms-1">*</span>
                )}
              </Label>
              <Input
                id="apis-surname"
                type="text"
                value={formData.surname}
                onChange={e => handleFieldChange("surname", e.target.value)}
                placeholder={t(
                  "apis.surnamePlaceholder",
                  "As shown on document"
                )}
                maxLength={100}
                className={cn(getFieldError("surname") && "border-destructive")}
              />
              {getFieldError("surname") && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {getFieldError("surname")}
                </p>
              )}
            </div>
          </div>

          {/* Date of Birth & Gender row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="apis-dob" className="text-sm font-medium">
                {t("apis.dateOfBirth", "Date of Birth")}
                {isRequired("dateOfBirth") && (
                  <span className="text-destructive ms-1">*</span>
                )}
              </Label>
              <Input
                id="apis-dob"
                type="date"
                value={formData.dateOfBirth}
                onChange={e => handleFieldChange("dateOfBirth", e.target.value)}
                max={new Date().toISOString().split("T")[0]}
                className={cn(
                  getFieldError("dateOfBirth") && "border-destructive"
                )}
              />
              {getFieldError("dateOfBirth") && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {getFieldError("dateOfBirth")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("apis.gender", "Gender")}
                {isRequired("gender") && (
                  <span className="text-destructive ms-1">*</span>
                )}
              </Label>
              <RadioGroup
                value={formData.gender}
                onValueChange={value =>
                  handleFieldChange("gender", value as Gender)
                }
                className="flex gap-4 pt-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="M" id="gender-m" />
                  <Label
                    htmlFor="gender-m"
                    className="font-normal cursor-pointer"
                  >
                    {t("apis.male", "Male")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="F" id="gender-f" />
                  <Label
                    htmlFor="gender-f"
                    className="font-normal cursor-pointer"
                  >
                    {t("apis.female", "Female")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="U" id="gender-u" />
                  <Label
                    htmlFor="gender-u"
                    className="font-normal cursor-pointer"
                  >
                    {t("apis.undisclosed", "Undisclosed")}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          {/* Nationality */}
          <div className="space-y-2">
            <Label htmlFor="apis-nationality" className="text-sm font-medium">
              {t("apis.nationality", "Nationality")}
              {isRequired("nationality") && (
                <span className="text-destructive ms-1">*</span>
              )}
            </Label>
            <Select
              value={formData.nationality}
              onValueChange={value => handleFieldChange("nationality", value)}
            >
              <SelectTrigger
                className={cn(
                  "w-full",
                  getFieldError("nationality") && "border-destructive"
                )}
              >
                <SelectValue
                  placeholder={t(
                    "apis.selectNationality",
                    "Select nationality"
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {COMMON_COUNTRIES.map(country => (
                  <SelectItem key={country.code} value={country.code}>
                    {country.code} - {country.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {getFieldError("nationality") && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {getFieldError("nationality")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Address Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            {t("apis.addressInfo", "Address Information")}
            {needsAddressInfo && (
              <Badge variant="secondary" className="ms-2 text-xs">
                {t("apis.requiredForDest", "Required for {{dest}}", {
                  dest: destinationCountry,
                })}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {t(
              "apis.addressDescription",
              "Address information may be required depending on your destination"
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Residence Country */}
          <div className="space-y-2">
            <Label
              htmlFor="apis-residence-country"
              className="text-sm font-medium"
            >
              {t("apis.residenceCountry", "Country of Residence")}
              {isRequired("residenceCountry") && (
                <span className="text-destructive ms-1">*</span>
              )}
            </Label>
            <Select
              value={formData.residenceCountry}
              onValueChange={value =>
                handleFieldChange("residenceCountry", value)
              }
            >
              <SelectTrigger
                className={cn(
                  "w-full",
                  getFieldError("residenceCountry") && "border-destructive"
                )}
              >
                <SelectValue
                  placeholder={t("apis.selectCountry", "Select country")}
                />
              </SelectTrigger>
              <SelectContent>
                {COMMON_COUNTRIES.map(country => (
                  <SelectItem key={country.code} value={country.code}>
                    {country.code} - {country.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {getFieldError("residenceCountry") && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {getFieldError("residenceCountry")}
              </p>
            )}
          </div>

          {/* Residence Address */}
          <div className="space-y-2">
            <Label
              htmlFor="apis-residence-address"
              className="text-sm font-medium"
            >
              {t("apis.residenceAddress", "Residence Address")}
              {isRequired("residenceAddress") && (
                <span className="text-destructive ms-1">*</span>
              )}
            </Label>
            <Input
              id="apis-residence-address"
              type="text"
              value={formData.residenceAddress}
              onChange={e =>
                handleFieldChange("residenceAddress", e.target.value)
              }
              placeholder={t(
                "apis.residenceAddressPlaceholder",
                "Street address, city, postal code"
              )}
              maxLength={500}
              className={cn(
                getFieldError("residenceAddress") && "border-destructive"
              )}
            />
            {getFieldError("residenceAddress") && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {getFieldError("residenceAddress")}
              </p>
            )}
          </div>

          {/* Destination Address */}
          <div className="space-y-2">
            <Label htmlFor="apis-dest-address" className="text-sm font-medium">
              {t("apis.destinationAddress", "Destination Address")}
              {isRequired("destinationAddress") && (
                <span className="text-destructive ms-1">*</span>
              )}
            </Label>
            <Input
              id="apis-dest-address"
              type="text"
              value={formData.destinationAddress}
              onChange={e =>
                handleFieldChange("destinationAddress", e.target.value)
              }
              placeholder={t(
                "apis.destinationAddressPlaceholder",
                "Hotel or address at destination"
              )}
              maxLength={500}
              className={cn(
                getFieldError("destinationAddress") && "border-destructive"
              )}
            />
            {getFieldError("destinationAddress") && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {getFieldError("destinationAddress")}
              </p>
            )}
          </div>

          {/* Redress & Known Traveler Numbers (primarily for US travel) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="apis-redress" className="text-sm font-medium">
                {t("apis.redressNumber", "Redress Number")}
                <span className="text-muted-foreground text-xs ms-1">
                  ({t("apis.optional", "Optional")})
                </span>
              </Label>
              <Input
                id="apis-redress"
                type="text"
                value={formData.redressNumber}
                onChange={e =>
                  handleFieldChange("redressNumber", e.target.value)
                }
                placeholder={t("apis.redressPlaceholder", "DHS Redress number")}
                maxLength={20}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apis-ktn" className="text-sm font-medium">
                {t("apis.knownTravelerNumber", "Known Traveler Number")}
                <span className="text-muted-foreground text-xs ms-1">
                  ({t("apis.optional", "Optional")})
                </span>
              </Label>
              <Input
                id="apis-ktn"
                type="text"
                value={formData.knownTravelerNumber}
                onChange={e =>
                  handleFieldChange("knownTravelerNumber", e.target.value)
                }
                placeholder={t(
                  "apis.ktnPlaceholder",
                  "TSA PreCheck / Global Entry"
                )}
                maxLength={25}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Validation Feedback */}
      {fieldErrors.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">
                  {t(
                    "apis.errorsTitle",
                    "Please correct the following errors:"
                  )}
                </p>
                <ul className="text-sm text-destructive/80 list-disc list-inside space-y-0.5">
                  {fieldErrors.map(error => (
                    <li key={error.field}>{error.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Route Requirements Info */}
      {requirementsQuery.data && (
        <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  {t("apis.routeRequirements", "Route Requirements")}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  {t(
                    "apis.submissionDeadline",
                    "Submit at least {{minutes}} minutes before departure",
                    {
                      minutes: requirementsQuery.data.submissionDeadlineMinutes,
                    }
                  )}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  {t("apis.messageFormat", "Format: {{format}}", {
                    format:
                      requirementsQuery.data.format === "paxlst"
                        ? "PAXLST (UN/EDIFACT)"
                        : "PNR/GOV",
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel", "Cancel")}
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting} className="min-w-[140px]">
          {isSubmitting ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              {t("apis.submitting", "Saving...")}
            </>
          ) : (
            <>
              <Check className="me-2 h-4 w-4" />
              {t("apis.submit", "Save Information")}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
