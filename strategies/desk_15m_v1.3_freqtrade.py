# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 15 דקות · ETHUSDT · 15m
# Version: v1.3 · Strategy family: rsi_reversion
# Backtest: return 3.16% · PF 1.22 · DD 5.99% · trades 32
# OOS: 2.39% · Sharpe 1.73
# Params: {"period":12,"oversold":18,"overbought":74,"atrStop":2.5,"rr":3}
# Target platform: Freqtrade
# Generated: 2026-11-22T21:58:26.341Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_15m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_15m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_15m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '15m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.030
    minimal_roi = {"0": 2.70, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=12)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 18)
        & (dataframe['rsi'].shift(1) > 18)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 74)
        & (dataframe['rsi'].shift(1) < 74)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 18)
        & (dataframe['rsi'].shift(1) > 18)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 74)
        & (dataframe['rsi'].shift(1) < 74)
            ),
            'exit_long',
        ] = 1
        return dataframe
