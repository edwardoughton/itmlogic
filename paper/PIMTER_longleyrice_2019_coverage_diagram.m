close all; clear all;

addpath('D:\Documents\sbir_sttr\facebook\longley-rice\lib')

%  Frequencies used in the campaign (GHz)
rxht       =  [1:1000];  % Receiver heights (m)        

prop.fmhz  =      2488;  % Frequency (MHz)
prop.ipol  =         1;  % Polarization selection (0=horizontal, 1=vertical)
prop.hg(2) =       100;  % Transmitter height (m) 
prop.eps   =        15;  % Terrain relative permittivity  -> unknown
prop.sgm   =     0.005;  % Terrain conductivity (S/m)     -> unknown
prop.ens0  =       314;  % Surface refractivity (N-units): also controls effective Earth radius -> unknown

prop.klim  =        5;   % Climate selection (1=equatorial, 2=continental subtropical, 3=maritime subtropical, 
                         %                    4=    desert, 5=  continental temperate, 6=maritime temperate overland, 
                         %                    7=maritime temperate, oversea   (5 is the default)

zsys       =       0.;   % Refractivity scaling ens=ens0*exp(-zsys/9460.);  (Average system elev above sea level)

% A few preliminary calcs
qc         =    [50.];   % Confidence  levels for predictions
qr         =    [50.];   % Reliability levels for predictions
DB         =      8.685890;  % Conversion factor to dB
NC         =    length(qc);
NR         =    length(qr);
ZR         = qerfi(qr/100);
ZC         = qerfi(qc/100);

prop.gma   =   157E-9;  % Inverse Earth radius
prop.ens   = prop.ens0;
if (zsys~=0.) 
  prop.ens = prop.ens*exp(-zsys/9460.); 
end
prop.gme   = prop.gma*(1.-0.04665*exp(prop.ens/179.3));

prop.wn    = prop.fmhz/47.7; 
zq         = complex(prop.eps,376.62*prop.sgm/prop.wn);      
prop.zgnd  = sqrt(zq-1.);

if (prop.ipol~=0)
  prop.zgnd= prop.zgnd/zq; 
end

load swagato/PIMTER_2019_Rx_Tx5_dem.mat;
nx        = length(terrain_length); 
rstep     =                     50; % Step every 10 points in range
num_range =   length(100:rstep:nx);

pl2p4_lr  = zeros(num_range,length(rxht));
pl2p4_lr2 = zeros(num_range,length(rxht));

irange=1;
for ipath=100:rstep:nx   % Loop over receiver ranges in coverage diagram
  clear PFL;
  PFL(1)=ipath-1;
  PFL(2)=terrain_length(2)-terrain_length(1);
  PFL(2+(1:PFL(1)+1))=terrain_height_no_tree(1:ipath);
  
  prop.d   = terrain_length(ipath)/1000;   % Length of profile (km)
  prop.pfl = PFL;
  
  for iht=1:length(rxht)                 % Tx ht (UAV)
        
      prop.hg(1) = rxht(iht);   % Antenna 2 height (m)

% Setup some intermediate quantities
      prop.lvar =    5;  % Initial values for AVAR control parameter: LVAR=0 for quantile change, 1 for dist change, 2 for HE change, 3 for WN change, 4 for MDVAR change, 5 for KLIM change
      prop.kwx  =    0;  % Zero out error flag
      prop.klimx  =  0;
      prop.mdvarx = 11;

      [prop]=qlrpfl(prop);

% Here HE = effective antenna heights, DL = horizon distances, THE = horizon elevation angles
% MDVAR = mode of variability calculation: 0=single message mode,
% 1=accidental mode, 2=mobile mode, 3 =broadcast mode, +10 =point-to-point, +20=interference

      FS=DB*log(2.*prop.wn*prop.dist);  % Free space loss in dB

%       Q=prop.dist-prop.dlsa; 
%       Q=max(Q-0.5*PFL(2),0)-max(-Q-0.5*PFL(2),0); 
%       if (Q<0) 
%         display('Line of sight path');
%       elseif (Q==0)
%         display('Single horizon path');
%       else
%         display('Double-horizon path');
%       end
%       if (prop.dist<=prop.dlsa)
%          display('Diffraction is the dominant mode');
%       elseif (prop.dist>prop.dx)
%          display('Tropospheric scatter is the dominant mode');
%       end
%       display(['Estimated quantiles of basic transmission loss (dB), free space value ' num2str(FS) ' dB']);
%       display(['Confidence levels ' num2str(qc(1)) ' ' num2str(qc(2)) ' ' num2str(qc(3))]);

      [avar1,prop]= avar(ZR,0.,ZC,prop);
      XLB=FS+avar1;
      pl2p4_lr(irange,iht) = -XLB;
      pl2p4_lr2(irange,iht) = -avar1;
      
%       if (prop.kwx==1)
%         display(['WARNING- SOME PARAMETERS ARE NEARLY OUT OF RANGE.  RESULTS SHOULD BE USED WITH CAUTION. ' num2str([iramge iht]) ]);
%       elseif (prop.kwx==2)
%         display(['NOTE- DEFAULT PARAMETERS HAVE BEEN SUBSTITUTED FOR IMPOSSIBLE ONES. ' num2str([irange iht]) ]);
%       elseif (prop.kwx==3)
%         display(['WARNING- A COMBINATION OF PARAMETERS IS OUT OF RANGE. RESULTS ARE PROBABLY INVALID. ' num2str([irange iht]) ]);
%       elseif (prop.kwx==4)
%         display(['WARNING- SOME PARAMETERS ARE OUT OF RANGE. RESULTS ARE PROBABLY INVALID. ' num2str([irange iht]) ]);
%       end
      
  end
    irange=irange+1;
  end


% figure
% 
% plot(freq,squeeze(-XLB(1,1,1:5,:,1)),'x','linewidth',3,'markersize',12);
% xlabel('Frequency (GHz)')
% ylabel('Path Loss (dB)')
% grid on
% set(gca,'Fontsize',24)

ZZ=zeros(num_range,1000); 
for i=1:1000
ZZ(:,i)=terrain_height_no_tree(100:50:end)+i;
end
pcolor(terrain_length(100:50:end)/1e3,ZZ',pl2p4_lr2'); shading flat
ylim([190 400])
caxis([-120 50])
colorbar
set(gca,'Fontsize',30)
xlabel('Distance (km)')
ylabel('Height (m)')
