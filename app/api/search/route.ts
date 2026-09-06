import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {getCurrentUser} from '@/lib/current-user';

const MAX_QUERY=64;
const PLAYER_LIMIT=12;
const CLAN_LIMIT=8;
const EVENT_LIMIT=8;
const TOURNAMENT_LIMIT=8;
const CASE_LIMIT=8;

export async function GET(req:NextRequest){
  const raw=(req.nextUrl.searchParams.get('q')||'').trim();
  const q=raw.slice(0,MAX_QUERY);
  if(q.length<2) return NextResponse.json({query:q,players:[],clans:[],events:[],tournaments:[],cases:[]},{headers:{'Cache-Control':'private, no-store'}});
  const user=await getCurrentUser().catch(()=>null);
  const now=new Date();
  const [players,clans,events,tournaments,cases]=await Promise.all([
    prisma.user.findMany({where:{deletedAt:null,status:'ACTIVE',isTestAccount:false,nickname:{contains:q,mode:'insensitive'}},select:{id:true,nickname:true,avatarUrl:true,steamAvatarUrl:true,level:true,playerStats:{select:{rating:true,wins:true,losses:true}}},orderBy:{nickname:'asc'},take:PLAYER_LIMIT}),
    prisma.clan.findMany({where:{OR:[{name:{contains:q,mode:'insensitive'}},{tag:{contains:q,mode:'insensitive'}}]},select:{id:true,name:true,tag:true,logoUrl:true,rating:true,wins:true,losses:true,_count:{select:{members:true}}},orderBy:[{rating:'desc'},{name:'asc'}],take:CLAN_LIMIT}),
    prisma.event.findMany({where:{status:{not:'CANCELLED'},name:{contains:q,mode:'insensitive'}},select:{id:true,name:true,icon:true,startsAt:true,endsAt:true,status:true,theme:true},orderBy:{startsAt:'desc'},take:EVENT_LIMIT}),
    prisma.tournament.findMany({where:{status:{not:'CANCELLED'},name:{contains:q,mode:'insensitive'}},select:{id:true,name:true,slug:true,status:true,startsAt:true,endsAt:true,maxPlayers:true,prizePool:true,_count:{select:{participants:true}}},orderBy:{startsAt:'desc'},take:TOURNAMENT_LIMIT}),
    prisma.duelCase.findMany({where:{active:true,OR:[{name:{contains:q,mode:'insensitive'}},{slug:{contains:q,mode:'insensitive'}}]},select:{id:true,name:true,slug:true,price:true,imageUrl:true},orderBy:{name:'asc'},take:CASE_LIMIT})
  ]);
  const eventRows=events.map(e=>({...e,status:e.endsAt<now?'ENDED':e.startsAt>now?'UPCOMING':'ACTIVE'}));
  const tournamentRows=tournaments.map(t=>({...t,prizePool:Number(t.prizePool),status:t.endsAt&&t.endsAt<now?'FINISHED':t.startsAt&&t.startsAt>now?'UPCOMING':t.status}));
  return NextResponse.json({query:q,viewerId:user?.id||null,players,clans,events:eventRows,tournaments:tournamentRows,cases:cases.map(c=>({...c,price:Number(c.price)}))},{headers:{'Cache-Control':'private, no-store'}});
}
