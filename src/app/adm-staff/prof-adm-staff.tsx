import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Modal,Pressable,ScrollView,Text,View} from 'react-native';
import {onAuthStateChanged,signOut,type User} from 'firebase/auth';
import {doc,getDoc} from 'firebase/firestore';
import {useRouter} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {auth,db} from '../../firebase/config';
import {C,Fade,Heading,S} from '../../components/AdminUI';
type Profile={fullName?:string;email?:string;phoneNumber?:string;role?:string;address?:string};
export default function AdminProfile(){const router=useRouter();const [user,setUser]=useState<User|null>(null);const [profile,setProfile]=useState<Profile|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [confirm,setConfirm]=useState(false);
 useEffect(()=>onAuthStateChanged(auth,next=>{setUser(next);setProfile(null);setLoading(true)}),[]);
 useEffect(()=>{let active=true;async function load(){if(!user){if(active)setLoading(false);return;}try{const snap=await getDoc(doc(db,'users',user.uid));if(active&&snap.exists())setProfile(snap.data() as Profile)}catch{}finally{if(active)setLoading(false)}}load();return()=>{active=false}},[user]);
 async function logout(){if(busy)return;setBusy(true);try{await signOut(auth);setConfirm(false);router.replace('/login')}catch{Alert.alert('Sign out failed','Please try again.')}finally{setBusy(false)}}
 const name=profile?.fullName?.trim()||user?.displayName||user?.email||'Staff account';
 return <ScrollView style={S.page} contentContainerStyle={S.content}><Heading label="YOUR ACCOUNT" title="My profile." description="View your SilkMart administrative account details."/>
 {!user||loading?<ActivityIndicator color={C.green} style={{marginTop:35}}/>:<Fade delay={150}>
 <View style={[S.card,{alignItems:'center',paddingVertical:25}]}><View style={{width:78,height:78,borderRadius:39,backgroundColor:C.soft,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:35,fontFamily:'serif',color:C.green}}>{name.charAt(0).toUpperCase()}</Text></View><Text style={[S.sectionTitle,{marginTop:13}]}>{name}</Text><Text style={[S.muted,{marginTop:5}]}>{user.email}</Text><View style={[S.badge,{marginTop:12}]}><Text style={S.badgeText}>{profile?.role||'Signed-in account'}</Text></View></View>
 <View style={S.card}><Text style={[S.sectionTitle,{marginBottom:12}]}>Personal Information</Text>{[['Full Name',name],['Email',user.email||'Not available'],['Phone',profile?.phoneNumber||'Not available'],['Address',profile?.address||'Not available']].map(([k,v])=><View key={k} style={{paddingVertical:11,borderTopWidth:1,borderColor:C.line}}><Text style={S.muted}>{k}</Text><Text style={[S.strong,{marginTop:4}]}>{v}</Text></View>)}</View>
 <Pressable onPress={()=>setConfirm(true)} style={[S.button,{backgroundColor:'#A43F3F'}]}><Ionicons name="log-out-outline" size={19} color="white"/><Text style={S.buttonText}>Sign Out</Text></Pressable>
 </Fade>}
 <Modal visible={confirm} transparent animationType="fade" onRequestClose={()=>setConfirm(false)}><View style={{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'center',padding:25}}><View style={[S.card,{padding:22,alignItems:'center'}]}><Text style={S.sectionTitle}>Sign Out?</Text><Text style={[S.muted,{textAlign:'center',marginVertical:15}]}>You will return to the SilkMart login screen.</Text><Pressable disabled={busy} style={[S.button,{backgroundColor:'#A43F3F',width:'100%'}]} onPress={logout}><Text style={S.buttonText}>{busy?'Signing out…':'Confirm Sign Out'}</Text></Pressable><Pressable onPress={()=>setConfirm(false)} disabled={busy} style={{padding:16}}><Text style={{color:C.green,fontWeight:'700'}}>Cancel</Text></Pressable></View></View></Modal>
 </ScrollView>}
