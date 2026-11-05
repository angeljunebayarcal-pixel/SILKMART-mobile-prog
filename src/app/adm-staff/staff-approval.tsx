
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";
import { C, Heading, S } from "../../components/AdminUI";

type ApprovalFilter =
  | "all"
  | "pending"
  | "approved"
  | "rejected";

type ApplicationStatus =
  | "pending"
  | "approved"
  | "rejected";

type ReviewAction = "approve" | "reject";

type StaffApplication = {
  id: string;
  applicantUid: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  address: string;
  status: ApplicationStatus;
  verificationIdName: string;
  verificationIdSize: number;
  rejectionReason: string;
  reviewedBy: string;
  createdAt: Timestamp | null;
  reviewedAt: Timestamp | null;
};

type IconName =
  React.ComponentProps<typeof Ionicons>["name"];

const GREEN = C.green;
const DARK = C.dark;
const MUTED = "#627C6E";
const LINE = C.line;
const CREAM = "#FFFDF8";
const RED = "#A43F3F";
const AMBER = "#A57226";
const SOFT = "#EAF2E8";

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asTimestamp(value: unknown): Timestamp | null {
  if (
    value !== null &&
    typeof value === "object" &&
    "toDate" in value &&
    "toMillis" in value &&
    typeof value.toDate === "function" &&
    typeof value.toMillis === "function"
  ) {
    return value as Timestamp;
  }

  return null;
}

function normalizeApplication(
  id: string,
  data: Record<string, unknown>
): StaffApplication {
  const rawStatus = stringValue(data.status).toLowerCase();

  const status: ApplicationStatus =
    rawStatus === "approved" || rawStatus === "rejected"
      ? rawStatus
      : "pending";

  return {
    id,
    applicantUid: stringValue(data.applicantUid) || id,
    fullName: stringValue(data.fullName),
    email: stringValue(data.email),
    phoneNumber: stringValue(data.phoneNumber),
    address: stringValue(data.address),
    status,
    verificationIdName: stringValue(data.verificationIdName),
    verificationIdSize:
      typeof data.verificationIdSize === "number"
        ? data.verificationIdSize
        : 0,
    rejectionReason: stringValue(data.rejectionReason),
    reviewedBy: stringValue(data.reviewedBy),
    createdAt: asTimestamp(data.createdAt),
    reviewedAt: asTimestamp(data.reviewedAt),
  };
}

function formatDate(value: Timestamp | null): string {
  if (!value) return "Not recorded";

  return value.toDate().toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function canReview(role: string): boolean {
  return ["administrator", "admin", "staff"].includes(
    role.toLowerCase()
  );
}

function statusColor(status: ApplicationStatus): string {
  if (status === "approved") return GREEN;
  if (status === "rejected") return RED;
  return AMBER;
}

function getErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error
      ? String(error.code)
      : "";

  if (
    code === "permission-denied" ||
    code === "firestore/permission-denied"
  ) {
    return "Firestore denied this action. Check your account permissions and published security rules.";
  }

  if (code === "unavailable" || code === "firestore/unavailable") {
    return "Firebase is unavailable. Check your internet connection.";
  }

  return error instanceof Error
    ? error.message
    : "Unable to complete this request.";
}

function SummaryCard({
  icon,
  label,
  value,
  subtitle,
  selected,
  onPress,
}: {
  icon: IconName;
  label: string;
  value: number;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.summaryCard,
        selected && styles.summaryCardSelected,
      ]}
    >
      <View style={styles.summaryIcon}>
        <Ionicons name={icon} size={20} color={GREEN} />
      </View>

      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summarySubtitle}>{subtitle}</Text>
    </Pressable>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>
        {value || "Not available"}
      </Text>
    </View>
  );
}

export default function StaffApproval() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [reviewerUid, setReviewerUid] = useState("");
  const [applications, setApplications] = useState<
    StaffApplication[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [filter, setFilter] =
    useState<ApprovalFilter>("pending");
  const [search, setSearch] = useState("");

  const [selected, setSelected] =
    useState<StaffApplication | null>(null);

  const [verificationImage, setVerificationImage] =
    useState("");

  const [verificationLoading, setVerificationLoading] =
    useState(false);

  const [verificationError, setVerificationError] =
    useState("");

  const [reviewAction, setReviewAction] =
    useState<ReviewAction | null>(null);

  const [rejectionReason, setRejectionReason] =
    useState("");

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const authSession = useRef(0);
  const reviewSession = useRef(0);
  const mountedRef = useRef(false);
  const savingRef = useRef(false);

  // =====================================
  // AUTHENTICATION
  // =====================================

  useEffect(() => {
    mountedRef.current = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async user => {
        const session = ++authSession.current;

        ++reviewSession.current;

        setAllowed(null);
        setReviewerUid("");
        setApplications([]);
        setSelected(null);
        setVerificationImage("");
        setVerificationError("");
        setReviewAction(null);
        setRejectionReason("");
        setActionError("");
        setNotice("");
        setError("");
        setLoading(true);

        if (!user) {
          setAllowed(false);
          setLoading(false);
          return;
        }

        try {
          const snapshot = await getDoc(
            doc(db, "users", user.uid)
          );

          if (
            !mountedRef.current ||
            session !== authSession.current ||
            auth.currentUser?.uid !== user.uid
          ) {
            return;
          }

          const role = stringValue(snapshot.data()?.role);
          const authorized = canReview(role);

          setAllowed(authorized);
          setReviewerUid(authorized ? user.uid : "");
          setLoading(authorized);
        } catch (reason) {
          if (
            mountedRef.current &&
            session === authSession.current
          ) {
            setAllowed(false);
            setLoading(false);
            setError(getErrorMessage(reason));
          }
        }
      }
    );

    return () => {
      mountedRef.current = false;
      ++authSession.current;
      ++reviewSession.current;
      unsubscribe();
    };
  }, []);

  // =====================================
  // FIRESTORE REAL-TIME APPLICATIONS
  // =====================================

  useEffect(() => {
    if (!allowed || !reviewerUid) return;

    let active = true;
    let generation = 0;

    let userUnsubscribes: Array<() => void> = [];

    setLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, "staffApplications"),
      snapshot => {
        if (
          !active ||
          auth.currentUser?.uid !== reviewerUid
        ) {
          return;
        }

        generation += 1;
        const currentGeneration = generation;

        userUnsubscribes.forEach(stop => stop());
        userUnsubscribes = [];

        const candidates = snapshot.docs.map(item =>
          normalizeApplication(item.id, item.data())
        );

        const applicantIds = Array.from(
          new Set(
            candidates.map(app => app.applicantUid)
          )
        );

        const accounts = new Map<
          string,
          Record<string, unknown> | null
        >();

        const refresh = () => {
          if (
            !active ||
            currentGeneration !== generation ||
            auth.currentUser?.uid !== reviewerUid ||
            accounts.size !== applicantIds.length
          ) {
            return;
          }

          // Show an application only when
          // its matching Firestore user still exists.
          const validApplications = candidates.filter(app => {
            const data = accounts.get(app.applicantUid);

            if (!data) return false;

            const role = stringValue(data.role);
            const accountStatus = stringValue(
              data.applicationStatus
            ).toLowerCase();

            const accountEmail = stringValue(
              data.email
            ).toLowerCase();

            const applicationEmail =
              app.email.trim().toLowerCase();

            const matchesAccount =
              app.status === "approved"
                ? role === "staff" &&
                  accountStatus === "approved"
                : role === "staffApplicant" &&
                  accountStatus === app.status;

            return (
              matchesAccount &&
              Boolean(accountEmail) &&
              accountEmail === applicationEmail
            );
          });

          validApplications.sort(
            (a, b) =>
              (b.createdAt?.toMillis() ?? 0) -
              (a.createdAt?.toMillis() ?? 0)
          );

          // Display only the newest valid application
          // when multiple records have the same email.
          const seenEmails = new Set<string>();

          const uniqueApplications =
            validApplications.filter(app => {
              const email = app.email.trim().toLowerCase();

              if (seenEmails.has(email)) {
                return false;
              }

              seenEmails.add(email);
              return true;
            });

          setApplications(uniqueApplications);
          setLoading(false);
          setError("");

          setSelected(current =>
            current
              ? uniqueApplications.find(
                  app => app.id === current.id
                ) || null
              : null
          );
        };

        if (applicantIds.length === 0) {
          setApplications([]);
          setSelected(null);
          setLoading(false);
          setError("");
          return;
        }

        setLoading(true);

        applicantIds.forEach(uid => {
          const stop = onSnapshot(
            doc(db, "users", uid),
            userDocument => {
              if (
                !active ||
                currentGeneration !== generation
              ) {
                return;
              }

              accounts.set(
                uid,
                userDocument.exists()
                  ? userDocument.data()
                  : null
              );

              refresh();
            },
            reason => {
              if (
                !active ||
                currentGeneration !== generation
              ) {
                return;
              }

              setLoading(false);
              setError(getErrorMessage(reason));
            }
          );

          userUnsubscribes.push(stop);
        });
      },
      reason => {
        if (!active) return;

        setApplications([]);
        setLoading(false);
        setError(getErrorMessage(reason));
      }
    );

    return () => {
      active = false;
      generation += 1;

      userUnsubscribes.forEach(stop => stop());
      unsubscribe();
    };
  }, [allowed, reviewerUid]);

  // =====================================
  // STATISTICS
  // =====================================

  const stats = useMemo(
    () => ({
      pending: applications.filter(
        app => app.status === "pending"
      ).length,

      approved: applications.filter(
        app => app.status === "approved"
      ).length,

      rejected: applications.filter(
        app => app.status === "rejected"
      ).length,
    }),
    [applications]
  );

  // =====================================
  // SEARCH AND FILTER
  // =====================================

  const filteredApplications = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return applications.filter(app => {
      const matchesStatus =
        filter === "all" || app.status === filter;

      const matchesSearch =
        !keyword ||
        [
          app.fullName,
          app.email,
          app.phoneNumber,
          app.applicantUid,
        ].some(value =>
          value.toLowerCase().includes(keyword)
        );

      return matchesStatus && matchesSearch;
    });
  }, [applications, filter, search]);

  // =====================================
  // VIEW APPLICATION
  // =====================================

  async function viewApplication(
    application: StaffApplication
  ) {
    if (!allowed || !reviewerUid || savingRef.current) {
      return;
    }

    const session = ++reviewSession.current;

    setSelected(application);
    setReviewAction(null);
    setRejectionReason("");
    setVerificationImage("");
    setVerificationError("");
    setActionError("");
    setVerificationLoading(true);

    try {
      const snapshot = await getDoc(
        doc(
          db,
          "staffVerificationIds",
          application.applicantUid
        )
      );

      if (
        session !== reviewSession.current ||
        auth.currentUser?.uid !== reviewerUid
      ) {
        return;
      }

      if (!snapshot.exists()) {
        setVerificationError(
          "No verification ID was found for this application."
        );
        return;
      }

      const imageData = snapshot.data().imageData;

      if (
        typeof imageData !== "string" ||
        !imageData.startsWith(
          "data:image/jpeg;base64,"
        )
      ) {
        setVerificationError(
          "The verification document is missing or has an unsupported format."
        );
        return;
      }

      setVerificationImage(imageData);
    } catch (reason) {
      if (session === reviewSession.current) {
        setVerificationError(getErrorMessage(reason));
      }
    } finally {
      if (session === reviewSession.current) {
        setVerificationLoading(false);
      }
    }
  }

  function closeDetails() {
    if (savingRef.current) return;

    ++reviewSession.current;

    setSelected(null);
    setReviewAction(null);
    setRejectionReason("");
    setVerificationImage("");
    setVerificationError("");
    setVerificationLoading(false);
    setActionError("");
  }

  function chooseAction(action: ReviewAction) {
    if (
      !selected ||
      selected.status !== "pending" ||
      savingRef.current
    ) {
      return;
    }

    if (action === "approve" && !verificationImage) {
      setActionError(
        "Review the submitted verification ID before approval."
      );
      return;
    }

    setActionError("");
    setRejectionReason("");
    setReviewAction(action);
  }

  // =====================================
  // APPROVE / REJECT
  // =====================================

  async function submitReview() {
    if (
      savingRef.current ||
      !selected ||
      !reviewAction ||
      !allowed ||
      !reviewerUid
    ) {
      return;
    }

    const applicant = selected;
    const action = reviewAction;
    const reason = rejectionReason.trim();
    const reviewer = reviewerUid;

    if (applicant.status !== "pending") {
      setActionError(
        "This application has already been reviewed."
      );
      return;
    }

    if (applicant.applicantUid === reviewer) {
      setActionError(
        "You cannot review your own application."
      );
      return;
    }

    if (action === "approve" && !verificationImage) {
      setActionError(
        "A valid verification ID must be reviewed before approval."
      );
      return;
    }

    if (
      action === "reject" &&
      (reason.length === 0 || reason.length > 500)
    ) {
      setActionError(
        "Provide a rejection reason of 1 to 500 characters."
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setActionError("");

    try {
      if (auth.currentUser?.uid !== reviewer) {
        throw new Error("AUTH_CHANGED");
      }

      const reviewerSnapshot = await getDoc(
        doc(db, "users", reviewer)
      );

      const userSnapshot = await getDoc(
        doc(
          db,
          "users",
          applicant.applicantUid
        )
      );

      const applicationSnapshot = await getDoc(
        doc(
          db,
          "staffApplications",
          applicant.applicantUid
        )
      );

      if (
        auth.currentUser?.uid !== reviewer ||
        !canReview(
          stringValue(reviewerSnapshot.data()?.role)
        )
      ) {
        throw new Error("NOT_AUTHORIZED");
      }

      if (
        !userSnapshot.exists() ||
        !applicationSnapshot.exists()
      ) {
        throw new Error("NOT_FOUND");
      }

      const userData = userSnapshot.data();
      const applicationData = applicationSnapshot.data();

      if (
        userData.role !== "staffApplicant" ||
        userData.applicationStatus !== "pending" ||
        applicationData.status !== "pending"
      ) {
        throw new Error("ALREADY_REVIEWED");
      }

      if (
        applicationData.applicantUid !==
        applicant.applicantUid
      ) {
        throw new Error("INVALID_APPLICATION");
      }

      const decision =
        action === "approve" ? "approved" : "rejected";

      const batch = writeBatch(db);

      batch.update(
        doc(
          db,
          "users",
          applicant.applicantUid
        ),
        {
          role:
            action === "approve"
              ? "staff"
              : "staffApplicant",

          applicationStatus: decision,
          reviewedBy: reviewer,
          reviewedAt: serverTimestamp(),
          rejectionReason:
            action === "reject" ? reason : "",
        }
      );

      batch.update(
        doc(
          db,
          "staffApplications",
          applicant.applicantUid
        ),
        {
          status: decision,
          reviewedBy: reviewer,
          reviewedAt: serverTimestamp(),
          rejectionReason:
            action === "reject" ? reason : "",
        }
      );

      await batch.commit();

      if (!mountedRef.current) return;

      closeDetails();

      setNotice(
        action === "approve"
          ? `${applicant.fullName} has been approved for Staff access.`
          : `${applicant.fullName}'s application was rejected.`
      );

      setFilter(
        action === "approve" ? "approved" : "rejected"
      );
    } catch (reason) {
      if (!mountedRef.current) return;

      let message = getErrorMessage(reason);

      if (reason instanceof Error) {
        if (reason.message === "ALREADY_REVIEWED") {
          message =
            "This application has already been reviewed.";
        } else if (reason.message === "NOT_FOUND") {
          message =
            "The applicant account or application record could not be found.";
        } else if (
          reason.message === "NOT_AUTHORIZED" ||
          reason.message === "AUTH_CHANGED"
        ) {
          message =
            "Your account is no longer authorized to review applications.";
        } else if (
          reason.message === "INVALID_APPLICATION"
        ) {
          message =
            "The application information is inconsistent.";
        }
      }

      setActionError(message);
    } finally {
      savingRef.current = false;

      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }

  // =====================================
  // SCREEN
  // =====================================

  return (
    <>
      <ScrollView
        style={S.page}
        contentContainerStyle={S.content}
        keyboardShouldPersistTaps="handled"
      >
        <Heading
          label="SILKMART · ADMINISTRATION"
          title="Staff Approval"
          description="Review staff applications, verify submitted identification, and manage staff access."
        />

        {allowed === null ? (
          <ActivityIndicator
            color={GREEN}
            style={styles.loading}
          />
        ) : !allowed ? (
          <View style={S.card}>
            <Ionicons
              name="shield-outline"
              size={33}
              color={GREEN}
            />

            <Text style={styles.accessTitle}>
              Authorized Staff access only
            </Text>

            <Text style={styles.accessText}>
              Only Administrators and already-approved
              Staff members may review applications.
            </Text>

            {!!error && (
              <Text style={styles.error}>{error}</Text>
            )}
          </View>
        ) : (
          <>
            {!!notice && (
              <View style={styles.successNotice}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={21}
                  color={GREEN}
                />

                <Text style={styles.successText}>
                  {notice}
                </Text>

                <Pressable onPress={() => setNotice("")}>
                  <Ionicons
                    name="close"
                    size={17}
                    color={GREEN}
                  />
                </Pressable>
              </View>
            )}

            <View style={styles.summaryGrid}>
              <SummaryCard
                icon="time-outline"
                label="Pending"
                value={stats.pending}
                subtitle="Awaiting review"
                selected={filter === "pending"}
                onPress={() => setFilter("pending")}
              />

              <SummaryCard
                icon="checkmark-circle-outline"
                label="Approved"
                value={stats.approved}
                subtitle="Staff access"
                selected={filter === "approved"}
                onPress={() => setFilter("approved")}
              />

              <SummaryCard
                icon="close-circle-outline"
                label="Rejected"
                value={stats.rejected}
                subtitle="Not approved"
                selected={filter === "rejected"}
                onPress={() => setFilter("rejected")}
              />
            </View>

            <View style={S.card}>
              <View style={styles.panelHeading}>
                <View style={{ flex: 1 }}>
                  <Text style={S.sectionTitle}>
                    Staff Applications
                  </Text>

                  <Text style={styles.panelDescription}>
                    Review personal details and
                    verification documents.
                  </Text>
                </View>

                <Text style={styles.recordCount}>
                  {filteredApplications.length} shown
                </Text>
              </View>

              <View style={styles.searchBox}>
                <Ionicons
                  name="search-outline"
                  size={19}
                  color={MUTED}
                />

                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name, email or applicant"
                  placeholderTextColor="#91A397"
                  style={styles.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {!!search && (
                  <Pressable onPress={() => setSearch("")}>
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={MUTED}
                    />
                  </Pressable>
                )}
              </View>

              <View style={styles.filterRow}>
                {(
                  [
                    "all",
                    "pending",
                    "approved",
                    "rejected",
                  ] as ApprovalFilter[]
                ).map(value => (
                  <Pressable
                    key={value}
                    onPress={() => setFilter(value)}
                    style={[
                      styles.filterChip,
                      filter === value &&
                        styles.filterChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        filter === value &&
                          styles.filterTextActive,
                      ]}
                    >
                      {value === "all"
                        ? "All"
                        : capitalize(value)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {loading && (
                <ActivityIndicator
                  color={GREEN}
                  style={styles.loading}
                />
              )}

              {!!error && (
                <Text style={styles.error}>{error}</Text>
              )}

              {!loading &&
                !error &&
                filteredApplications.length === 0 && (
                  <View style={styles.empty}>
                    <Ionicons
                      name="file-tray-outline"
                      size={38}
                      color={GREEN}
                    />

                    <Text style={styles.emptyTitle}>
                      No applications found
                    </Text>

                    <Text style={styles.emptyText}>
                      {search.trim()
                        ? "Try a different search term."
                        : filter === "pending"
                          ? "No pending staff applications."
                          : "No applications match this filter."}
                    </Text>
                  </View>
                )}

              {!loading &&
                !error &&
                filteredApplications.map(app => (
                  <View
                    key={app.id}
                    style={styles.applicationCard}
                  >
                    <View style={styles.applicantTop}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {app.fullName
                            .charAt(0)
                            .toUpperCase() || "S"}
                        </Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={styles.applicantName}>
                          {app.fullName || "Staff Applicant"}
                        </Text>

                        <Text style={styles.applicantEmail}>
                          {app.email}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor:
                              app.status === "approved"
                                ? "#E5F2E7"
                                : app.status === "rejected"
                                  ? "#FBEAEA"
                                  : "#FFF3DC",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            {
                              color: statusColor(app.status),
                            },
                          ]}
                        >
                          {capitalize(app.status)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons
                        name="call-outline"
                        size={15}
                        color={MUTED}
                      />

                      <Text style={styles.infoText}>
                        {app.phoneNumber || "No mobile number"}
                      </Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons
                        name="calendar-outline"
                        size={15}
                        color={MUTED}
                      />

                      <Text style={styles.infoText}>
                        {formatDate(app.createdAt)}
                      </Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons
                        name="document-attach-outline"
                        size={15}
                        color={MUTED}
                      />

                      <Text style={styles.infoText}>
                        {app.verificationIdName
                          ? "Verification ID listed"
                          : "Verification ID not listed"}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => void viewApplication(app)}
                      style={styles.reviewButton}
                    >
                      <Ionicons
                        name="eye-outline"
                        size={17}
                        color="#FFFFFF"
                      />

                      <Text style={styles.reviewButtonText}>
                        Review Application
                      </Text>

                      <Ionicons
                        name="arrow-forward"
                        size={16}
                        color="#FFFFFF"
                      />
                    </Pressable>
                  </View>
                ))}
            </View>

            <View style={styles.securityCard}>
              <Ionicons
                name="shield-checkmark-outline"
                size={22}
                color={GREEN}
              />

              <Text style={styles.securityText}>
                Administrators and approved Staff may
                review applications. Verify applicant
                identity against authorized PTRI records
                before approval. Decisions are recorded
                in Firestore.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* APPLICATION DETAILS MODAL */}

      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={closeDetails}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalEyebrow}>
                  STAFF IDENTITY VERIFICATION
                </Text>

                <Text style={styles.modalTitle}>
                  Review Application
                </Text>

                <Text style={styles.modalSubtitle}>
                  {selected?.fullName}
                </Text>
              </View>

              <Pressable
                disabled={saving}
                onPress={closeDetails}
                style={styles.closeButton}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={DARK}
                />
              </Pressable>
            </View>

            {selected && (
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalContent}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.sectionHeading}>
                  Applicant Information
                </Text>

                <Detail
                  label="Full Name"
                  value={selected.fullName}
                />

                <Detail
                  label="Email Address"
                  value={selected.email}
                />

                <Detail
                  label="Mobile Number"
                  value={selected.phoneNumber}
                />

                <Detail
                  label="Application Date"
                  value={formatDate(selected.createdAt)}
                />

                <Detail
                  label="Complete Address"
                  value={selected.address}
                />

                <Detail
                  label="Application Status"
                  value={capitalize(selected.status)}
                />

                {selected.reviewedAt && (
                  <Detail
                    label="Reviewed At"
                    value={formatDate(selected.reviewedAt)}
                  />
                )}

                {selected.status === "rejected" &&
                  !!selected.rejectionReason && (
                    <View style={styles.rejectionBox}>
                      <Text style={styles.rejectionTitle}>
                        Rejection Reason
                      </Text>

                      <Text style={styles.rejectionText}>
                        {selected.rejectionReason}
                      </Text>
                    </View>
                  )}

                <Text style={styles.sectionHeading}>
                  Verification Document
                </Text>

                <Text style={styles.documentHelp}>
                  Review the submitted ID and confirm
                  that the applicant is authorized
                  to work as PTRI Staff.
                </Text>

                {verificationLoading ? (
                  <View style={styles.imageState}>
                    <ActivityIndicator color={GREEN} />

                    <Text style={styles.imageStateText}>
                      Loading verification ID...
                    </Text>
                  </View>
                ) : verificationError ? (
                  <View style={styles.imageState}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={30}
                      color={RED}
                    />

                    <Text style={styles.imageStateText}>
                      {verificationError}
                    </Text>
                  </View>
                ) : verificationImage ? (
                  <Image
                    source={{ uri: verificationImage }}
                    style={styles.verificationImage}
                    resizeMode="contain"
                    accessibilityLabel="Submitted staff verification ID"
                  />
                ) : (
                  <Text style={styles.documentHelp}>
                    No verification ID loaded.
                  </Text>
                )}

                <View style={styles.privacyNotice}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={GREEN}
                  />

                  <Text style={styles.privacyText}>
                    Verification documents contain private
                    applicant information. Do not share
                    them outside authorized review.
                  </Text>
                </View>

                {!!actionError && (
                  <Text style={styles.error}>
                    {actionError}
                  </Text>
                )}

                {selected.status === "pending" && (
                  <View style={styles.actionArea}>
                    {reviewAction === null ? (
                      <>
                        <Text style={styles.actionHint}>
                          Select an action after checking
                          the applicant's identity.
                        </Text>

                        <View style={styles.actionRow}>
                          <Pressable
                            disabled={saving}
                            onPress={() =>
                              chooseAction("reject")
                            }
                            style={styles.rejectButton}
                          >
                            <Ionicons
                              name="close-circle-outline"
                              size={18}
                              color={RED}
                            />

                            <Text style={styles.rejectText}>
                              Reject
                            </Text>
                          </Pressable>

                          <Pressable
                            disabled={
                              saving ||
                              verificationLoading ||
                              !verificationImage
                            }
                            onPress={() =>
                              chooseAction("approve")
                            }
                            style={[
                              styles.approveButton,
                              (!verificationImage ||
                                verificationLoading) &&
                                styles.disabledButton,
                            ]}
                          >
                            <Ionicons
                              name="checkmark-circle-outline"
                              size={18}
                              color="#FFFFFF"
                            />

                            <Text style={styles.approveText}>
                              Approve Staff
                            </Text>
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <View style={styles.confirmationBox}>
                        <Text style={styles.confirmationTitle}>
                          {reviewAction === "approve"
                            ? "Confirm Staff Approval"
                            : "Reject Staff Application"}
                        </Text>

                        <Text style={styles.confirmationText}>
                          {reviewAction === "approve"
                            ? `Grant Staff access to ${selected.fullName}?`
                            : `Reject ${selected.fullName}'s application?`}
                        </Text>

                        {reviewAction === "reject" && (
                          <>
                            <Text style={styles.reasonLabel}>
                              Reason for rejection
                            </Text>

                            <TextInput
                              value={rejectionReason}
                              onChangeText={setRejectionReason}
                              placeholder="Explain the reason..."
                              placeholderTextColor="#9BAEA2"
                              multiline
                              maxLength={500}
                              textAlignVertical="top"
                              editable={!saving}
                              style={styles.reasonInput}
                            />

                            <Text style={styles.characterCount}>
                              {rejectionReason.length}/500
                            </Text>
                          </>
                        )}

                        <View style={styles.actionRow}>
                          <Pressable
                            disabled={saving}
                            onPress={() => {
                              setReviewAction(null);
                              setActionError("");
                            }}
                            style={styles.cancelButton}
                          >
                            <Text style={styles.cancelText}>
                              Cancel
                            </Text>
                          </Pressable>

                          <Pressable
                            disabled={
                              saving ||
                              (reviewAction === "reject" &&
                                !rejectionReason.trim())
                            }
                            onPress={() =>
                              void submitReview()
                            }
                            style={[
                              styles.finalButton,
                              reviewAction === "reject" &&
                                styles.finalRejectButton,
                            ]}
                          >
                            {saving ? (
                              <ActivityIndicator
                                color="#FFFFFF"
                                size="small"
                              />
                            ) : (
                              <Text style={styles.finalText}>
                                {reviewAction === "approve"
                                  ? "Confirm Approval"
                                  : "Confirm Rejection"}
                              </Text>
                            )}
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </ScrollView>
            )}

            <View style={styles.modalFooter}>
              <Pressable
                disabled={saving}
                onPress={closeDetails}
                style={[
                  styles.closeReviewButton,
                  saving && styles.disabledButton,
                ]}
              >
                <Text style={styles.closeReviewText}>
                  Close Review
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  loading: {
    marginVertical: 24,
  },

  accessTitle: {
    color: DARK,
    fontSize: 20,
    fontFamily: "serif",
    marginTop: 15,
  },

  accessText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 20,
    marginTop: 8,
  },

  successNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    backgroundColor: SOFT,
    borderRadius: 12,
    marginBottom: 15,
  },

  successText: {
    flex: 1,
    color: GREEN,
    fontSize: 12,
    lineHeight: 19,
  },

  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 17,
  },

  summaryCard: {
    flexGrow: 1,
    flexBasis: 94,
    minWidth: 94,
    backgroundColor: CREAM,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    padding: 12,
    gap: 5,
  },

  summaryCardSelected: {
    borderColor: GREEN,
    backgroundColor: "#E8F0E7",
  },

  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#E8F0E7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 3,
  },

  summaryLabel: {
    color: DARK,
    fontSize: 12,
    fontWeight: "700",
  },

  summaryValue: {
    color: GREEN,
    fontSize: 26,
    fontWeight: "700",
  },

  summarySubtitle: {
    color: MUTED,
    fontSize: 10,
  },

  panelHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 15,
  },

  panelDescription: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 6,
  },

  recordCount: {
    color: MUTED,
    fontSize: 10,
    marginTop: 3,
  },

  searchBox: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 11,
    paddingHorizontal: 12,
    backgroundColor: CREAM,
    marginBottom: 12,
  },

  searchInput: {
    flex: 1,
    color: DARK,
    fontSize: 12,
    height: "100%",
    minWidth: 0,
  },

  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 10,
  },

  filterChip: {
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CREAM,
  },

  filterChipActive: {
    borderColor: GREEN,
    backgroundColor: GREEN,
  },

  filterText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
  },

  filterTextActive: {
    color: "#FFFFFF",
  },

  error: {
    color: RED,
    fontSize: 12,
    lineHeight: 19,
    marginVertical: 12,
  },

  empty: {
    alignItems: "center",
    paddingVertical: 35,
    paddingHorizontal: 12,
  },

  emptyTitle: {
    color: DARK,
    fontSize: 20,
    fontFamily: "serif",
    marginTop: 12,
  },

  emptyText: {
    color: MUTED,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 7,
  },

  applicationCard: {
    paddingVertical: 19,
    borderTopWidth: 1,
    borderTopColor: LINE,
    gap: 10,
  },

  applicantTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#E8F0E7",
    alignItems: "center",
    justifyContent: "center",
  },

  avatarText: {
    fontFamily: "serif",
    fontSize: 22,
    color: GREEN,
  },

  applicantName: {
    color: DARK,
    fontSize: 13,
    fontWeight: "700",
  },

  applicantEmail: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
  },

  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 12,
  },

  statusText: {
    fontSize: 10,
    fontWeight: "700",
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  infoText: {
    color: MUTED,
    fontSize: 11,
    flex: 1,
  },

  reviewButton: {
    backgroundColor: GREEN,
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 6,
  },

  reviewButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  securityCard: {
    backgroundColor: SOFT,
    borderRadius: 13,
    padding: 15,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 14,
  },

  securityText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 16,
  },

  modalCard: {
    width: "100%",
    maxWidth: 550,
    maxHeight: "92%",
    alignSelf: "center",
    backgroundColor: CREAM,
    borderRadius: 21,
    overflow: "hidden",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 19,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },

  modalEyebrow: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.3,
  },

  modalTitle: {
    fontFamily: "serif",
    color: DARK,
    fontSize: 24,
    marginTop: 5,
  },

  modalSubtitle: {
    color: MUTED,
    fontSize: 12,
    marginTop: 5,
  },

  closeButton: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  modalScroll: {
    flexShrink: 1,
  },

  modalContent: {
    padding: 19,
    paddingBottom: 25,
  },

  sectionHeading: {
    color: DARK,
    fontSize: 17,
    fontFamily: "serif",
    marginTop: 8,
    marginBottom: 15,
  },

  detailRow: {
    marginBottom: 14,
  },

  detailLabel: {
    color: MUTED,
    fontSize: 10,
  },

  detailValue: {
    color: DARK,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
    marginTop: 5,
  },

  documentHelp: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    marginBottom: 12,
  },

  imageState: {
    backgroundColor: "#F2F5EF",
    minHeight: 180,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    gap: 12,
  },

  imageStateText: {
    color: MUTED,
    textAlign: "center",
    fontSize: 12,
    lineHeight: 19,
  },

  verificationImage: {
    width: "100%",
    height: 290,
    borderRadius: 12,
    backgroundColor: "#F2F5EF",
  },

  rejectionBox: {
    backgroundColor: "#FBEAEA",
    borderRadius: 11,
    padding: 13,
    marginVertical: 12,
  },

  rejectionTitle: {
    color: RED,
    fontSize: 12,
    fontWeight: "700",
  },

  rejectionText: {
    color: DARK,
    fontSize: 11,
    lineHeight: 19,
    marginTop: 7,
  },

  privacyNotice: {
    backgroundColor: SOFT,
    flexDirection: "row",
    gap: 9,
    borderRadius: 12,
    padding: 13,
    marginTop: 17,
  },

  privacyText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
  },

  actionArea: {
    marginTop: 22,
  },

  actionHint: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
    marginBottom: 12,
  },

  actionRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 10,
  },

  rejectButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8C9C3",
    backgroundColor: "#FFF8F5",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },

  rejectText: {
    color: RED,
    fontSize: 12,
    fontWeight: "700",
  },

  approveButton: {
    flex: 1.5,
    minHeight: 46,
    backgroundColor: GREEN,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  approveText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  disabledButton: {
    opacity: 0.5,
  },

  confirmationBox: {
    backgroundColor: "#F2F5EF",
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: LINE,
  },

  confirmationTitle: {
    color: DARK,
    fontSize: 16,
    fontWeight: "700",
  },

  confirmationText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
  },

  reasonLabel: {
    color: DARK,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 16,
    marginBottom: 7,
  },

  reasonInput: {
    backgroundColor: CREAM,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 10,
    padding: 12,
    minHeight: 95,
    color: DARK,
    fontSize: 12,
  },

  characterCount: {
    color: MUTED,
    fontSize: 10,
    textAlign: "right",
    marginTop: 6,
  },

  cancelButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CREAM,
  },

  cancelText: {
    color: DARK,
    fontSize: 12,
    fontWeight: "700",
  },

  finalButton: {
    flex: 1.5,
    minHeight: 44,
    backgroundColor: GREEN,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  finalRejectButton: {
    backgroundColor: RED,
  },

  finalText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  modalFooter: {
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },

  closeReviewButton: {
    backgroundColor: GREEN,
    minHeight: 47,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  closeReviewText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});
